/** Local-only text and Word import. Only the main Word document is extracted. */
const DocumentReader = (() => {
  'use strict';
  const TEXT_LIMIT = 2 * 1024 * 1024;
  const WORD_LIMIT = 5 * 1024 * 1024;
  const XML_LIMIT = 8 * 1024 * 1024;
  const W = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
  const invalid = () => new Error('Wordファイルを読み取れません。Wordで開き、.docx形式で保存し直してください。');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function documentXML(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (n) => view.getUint16(n, true);
    const u32 = (n) => view.getUint32(n, true);
    let end = -1;
    for (let n = bytes.length - 22; n >= Math.max(0, bytes.length - 65557); n--) {
      if (u32(n) === 0x06054b50 && n + 22 + u16(n + 20) === bytes.length) { end = n; break; }
    }
    if (end < 0 || u16(end + 4) || u16(end + 6)) throw invalid();
    const count = u16(end + 10), directorySize = u32(end + 12), directory = u32(end + 16);
    if (!count || count > 2048 || u16(end + 8) !== count || directory + directorySize !== end) throw invalid();
    let at = directory, target = null, contentTypes = false;
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || u32(at) !== 0x02014b50) throw invalid();
      const nameLength = u16(at + 28), next = at + 46 + nameLength + u16(at + 30) + u16(at + 32);
      if (next > end || u16(at + 34)) throw invalid();
      const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      if (name === '[Content_Types].xml') contentTypes = true;
      if (name === 'word/document.xml') {
        if (target) throw invalid();
        target = { flags: u16(at + 8), method: u16(at + 10), crc: u32(at + 16), size: u32(at + 20), original: u32(at + 24), offset: u32(at + 42), name };
      }
      at = next;
    }
    if (at !== end || !target || !contentTypes) throw invalid();
    if (target.flags & 1) throw new Error('暗号化されたWordは読み込めません。暗号化なしの.docxで保存してください。');
    if (target.original > XML_LIMIT) throw new Error('Wordの本文が大きすぎます。問題集を分割してください。');
    const p = target.offset;
    if (p + 30 > directory || u32(p) !== 0x04034b50 || u16(p + 6) !== target.flags || u16(p + 8) !== target.method) throw invalid();
    const start = p + 30 + u16(p + 26) + u16(p + 28);
    if (start + target.size > directory || utf8.decode(bytes.subarray(p + 30, p + 30 + u16(p + 26))) !== target.name) throw invalid();
    const compressed = bytes.subarray(start, start + target.size);
    const chunks = []; let total = 0, finished = false;
    const take = (chunk, final) => {
      total += chunk.length;
      if (total > XML_LIMIT || total > target.original) throw new Error('Wordの本文サイズが不正か、上限を超えています。');
      chunks.push(chunk.slice()); finished = final;
    };
    if (target.method === 0) take(compressed, true);
    else if (target.method === 8) {
      const stream = new fflate.Inflate(take);
      // Bound each inflation step instead of expanding the whole archive.
      for (let n = 0; n < compressed.length; n += 1024) stream.push(compressed.subarray(n, n + 1024), n + 1024 >= compressed.length);
    } else throw new Error('このWordの圧縮形式には未対応です。.docx形式で保存し直してください。');
    if (!finished || total !== target.original) throw invalid();
    const output = new Uint8Array(total); let pos = 0;
    for (const chunk of chunks) { output.set(chunk, pos); pos += chunk.length; }
    if (crc32(output) !== target.crc) throw invalid();
    return utf8.decode(output);
  }
  function extractText(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !W.includes(doc.documentElement.namespaceURI) || doc.documentElement.localName !== 'document') throw invalid();
    const ns = doc.documentElement.namespaceURI;
    for (const tag of ['drawing', 'pict', 'object', 'altChunk']) {
      if (doc.getElementsByTagNameNS(ns, tag).length) throw new Error('画像・埋め込み資料を含むWordは未対応です。文字だけの問題集にしてください。');
    }
    for (const mathNS of ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'http://purl.oclc.org/ooxml/officeDocument/math']) {
      if (['oMath', 'oMathPara'].some(tag => doc.getElementsByTagNameNS(mathNS, tag).length)) throw new Error('Wordの数式は未対応です。数式を通常の文字に変えてください。');
    }
    function inline(node) {
      if (node.nodeType !== 1) return '';
      if (node.namespaceURI === ns) {
        if (['del', 'moveFrom', 'pPr', 'rPr'].includes(node.localName)) return '';
        if (node.localName === 't') return node.textContent;
        if (['br', 'cr'].includes(node.localName)) return '\n';
        if (node.localName === 'tab') return '\t';
      }
      return Array.from(node.childNodes).map(inline).join('');
    }
    const body = doc.getElementsByTagNameNS(ns, 'body')[0];
    if (!body) throw invalid();
    const lines = Array.from(body.getElementsByTagNameNS(ns, 'p')).filter((p) => {
      for (let parent = p.parentNode; parent && parent !== body; parent = parent.parentNode) {
        if (parent.namespaceURI === ns && ['del', 'moveFrom'].includes(parent.localName)) return false;
      }
      return true;
    }).map(inline);
    const text = lines.join('\n').trim();
    if (!text) throw new Error('Wordの本文に問題がありません。画像だけの資料には未対応です。');
    return text;
  }
  async function read(file) {
    const filename = file.name || '問題集.txt';
    const extension = filename.toLowerCase().split('.').pop();
    if (!['json', 'txt', 'md', 'markdown', 'docx'].includes(extension)) throw new Error('JSON・Word（.docx）・テキスト（.txt）・Markdown（.md）を選んでください。');
    const word = extension === 'docx';
    if (file.size > (word ? WORD_LIMIT : TEXT_LIMIT)) throw new Error(word ? 'Wordは5 MiB以下に分割してください。' : 'ファイルは2 MiB以下に分割してください。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > (word ? WORD_LIMIT : TEXT_LIMIT)) throw new Error('ファイルが大きすぎます。分割してください。');
    let text;
    try { text = word ? extractText(documentXML(bytes)) : utf8.decode(bytes); }
    catch (error) {
      if (!word && (error instanceof RangeError || error instanceof TypeError)) throw new Error('UTF-8形式のテキストで保存し直してください。');
      if (word && !/[ぁ-んァ-ン一-龥]/.test(error.message)) throw invalid();
      throw error;
    }
    if (new TextEncoder().encode(text).length > TEXT_LIMIT) throw new Error('問題の本文は2 MiB以下に分割してください。');
    return { text, filename };
  }
  return { read };
})();
