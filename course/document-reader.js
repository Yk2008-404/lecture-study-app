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
  /** Lists a ZIP's entries from its central directory. Nothing is decompressed here. */
  function readZip(bytes, { legacyNames = false } = {}) {
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
    // Windows Explorer writes Japanese names in Shift_JIS without the UTF-8 flag.
    const sjis = legacyNames ? new TextDecoder('shift_jis') : null;
    let at = directory;
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || u32(at) !== 0x02014b50) throw invalid();
      const nameLength = u16(at + 28), next = at + 46 + nameLength + u16(at + 30) + u16(at + 32);
      if (next > end || u16(at + 34)) throw invalid();
      const raw = bytes.subarray(at + 46, at + 46 + nameLength), flags = u16(at + 8);
      let name;
      try { name = utf8.decode(raw); } catch (error) { if (!sjis || (flags & 0x800)) throw error; name = sjis.decode(raw); }
      if (entries.has(name)) throw invalid();
      entries.set(name, { name, flags, method: u16(at + 10), crc: u32(at + 16), size: u32(at + 20), original: u32(at + 24), offset: u32(at + 42), nameLength });
      at = next;
    }
    if (at !== end) throw invalid();
    return { entries, directory, u16, u32 };
  }
  /** Decompresses one entry with a size limit and a CRC check. */
  function extract(bytes, zip, target, limit, tooLarge) {
    const { directory, u16, u32 } = zip;
    if (target.flags & 1) throw new Error('暗号化されたファイルは読み込めません。暗号化なしで保存してください。');
    if (target.original > limit) throw new Error(tooLarge);
    const p = target.offset;
    if (p + 30 > directory || u32(p) !== 0x04034b50 || u16(p + 6) !== target.flags || u16(p + 8) !== target.method) throw invalid();
    const start = p + 30 + u16(p + 26) + u16(p + 28);
    if (start + target.size > directory || u16(p + 26) !== target.nameLength) throw invalid();
    const compressed = bytes.subarray(start, start + target.size);
    const chunks = []; let total = 0, finished = false;
    const take = (chunk, final) => {
      total += chunk.length;
      if (total > limit || total > target.original) throw new Error(tooLarge);
      chunks.push(chunk.slice()); finished = final;
    };
    if (target.method === 0) take(compressed, true);
    else if (target.method === 8) {
      const stream = new fflate.Inflate(take);
      // Bound each inflation step instead of expanding the whole archive.
      for (let n = 0; n < compressed.length; n += 1024) stream.push(compressed.subarray(n, n + 1024), n + 1024 >= compressed.length);
    } else throw new Error('このファイルの圧縮形式には未対応です。保存し直してください。');
    if (!finished || total !== target.original) throw invalid();
    const output = new Uint8Array(total); let pos = 0;
    for (const chunk of chunks) { output.set(chunk, pos); pos += chunk.length; }
    if (crc32(output) !== target.crc) throw invalid();
    return output;
  }
  function documentXML(bytes) {
    const zip = readZip(bytes);
    const target = zip.entries.get('word/document.xml');
    if (!target || !zip.entries.has('[Content_Types].xml')) throw invalid();
    if (target.flags & 1) throw new Error('暗号化されたWordは読み込めません。暗号化なしの.docxで保存してください。');
    if (target.original > XML_LIMIT) throw new Error('Wordの本文が大きすぎます。問題集を分割してください。');
    try { return utf8.decode(extract(bytes, zip, target, XML_LIMIT, 'Wordの本文サイズが不正か、上限を超えています。')); }
    catch (error) { if (/圧縮形式/.test(error.message)) throw new Error('このWordの圧縮形式には未対応です。.docx形式で保存し直してください。'); throw error; }
  }
  // Red text (or red highlight) is what lecture handouts usually mark as answers or key terms.
  function isRed(run, ns) {
    const props = Array.from(run.childNodes).find(n => n.namespaceURI === ns && n.localName === 'rPr');
    if (!props) return false;
    for (const node of props.childNodes) {
      if (node.namespaceURI !== ns) continue;
      const value = (node.getAttributeNS(ns, 'val') || '').toLowerCase();
      if (node.localName === 'highlight' && ['red', 'darkred'].includes(value)) return true;
      if (node.localName === 'color' && /^[0-9a-f]{6}$/.test(value)) {
        const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
        if (r >= 0xb0 && g <= 0x70 && b <= 0x70) return true;
      }
    }
    return false;
  }
  /** markRed: wrap red runs in 【赤】…【/赤】. lenient: skip images and equations instead of refusing. */
  function extractText(xml, { markRed = false, lenient = false } = {}) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !W.includes(doc.documentElement.namespaceURI) || doc.documentElement.localName !== 'document') throw invalid();
    const ns = doc.documentElement.namespaceURI;
    const skipped = { images: 0, equations: 0 };
    for (const tag of ['drawing', 'pict', 'object', 'altChunk']) {
      const count = doc.getElementsByTagNameNS(ns, tag).length;
      if (count && !lenient) throw new Error('画像・埋め込み資料を含むWordは未対応です。文字だけの問題集にしてください。');
      skipped.images += count;
    }
    for (const mathNS of ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'http://purl.oclc.org/ooxml/officeDocument/math']) {
      const count = ['oMath', 'oMathPara'].reduce((n, tag) => n + doc.getElementsByTagNameNS(mathNS, tag).length, 0);
      if (count && !lenient) throw new Error('Wordの数式は未対応です。数式を通常の文字に変えてください。');
      skipped.equations += count;
    }
    function inline(node) {
      if (node.nodeType !== 1) return '';
      if (node.namespaceURI === ns) {
        if (['del', 'moveFrom', 'pPr', 'rPr'].includes(node.localName)) return '';
        if (node.localName === 't') return node.textContent;
        if (['br', 'cr'].includes(node.localName)) return '\n';
        if (node.localName === 'tab') return '\t';
        if (markRed && node.localName === 'r' && isRed(node, ns)) {
          const text = Array.from(node.childNodes).map(inline).join('');
          return text.trim() ? '\u0001' + text + '\u0002' : text;
        }
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
    // Adjacent red runs (Word splits words into several runs) become one marked span.
    const text = lines.join('\n').replace(/\u0002\u0001/g, '').replace(/\u0001/g, '【赤】').replace(/\u0002/g, '【/赤】').trim();
    if (!text) throw new Error('Wordの本文に問題がありません。画像だけの資料には未対応です。');
    return markRed || lenient ? { text, skipped } : text;
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
  /** For AI question generation: Word with red text marked, images and equations skipped and counted. */
  async function readForGeneration(file) {
    const filename = file.name || '資料.docx';
    if (filename.toLowerCase().split('.').pop() !== 'docx') throw new Error('Word（.docx）ファイルを選んでください。');
    if (file.size > WORD_LIMIT) throw new Error('Wordは5 MiB以下に分割してください。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > WORD_LIMIT) throw new Error('ファイルが大きすぎます。分割してください。');
    let result;
    try { result = extractText(documentXML(bytes), { markRed: true, lenient: true }); }
    catch (error) { if (!/[ぁ-んァ-ン一-龥]/.test(error.message)) throw invalid(); throw error; }
    return { filename, text: result.text, skipped: result.skipped, red: (result.text.match(/【赤】/g) || []).length };
  }
  /** For the report checker: Word or text. Images and equations are skipped (counted), never refused. */
  async function readReport(file) {
    const filename = file.name || 'レポート.docx';
    const extension = filename.toLowerCase().split('.').pop();
    if (!['docx', 'txt', 'md', 'markdown'].includes(extension)) throw new Error('Word（.docx）またはテキスト（.txt）を選んでください。');
    const word = extension === 'docx';
    if (file.size > (word ? WORD_LIMIT : TEXT_LIMIT)) throw new Error('ファイルが大きすぎます。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!word) {
      try { return { filename, text: utf8.decode(bytes), skipped: { images: 0, equations: 0 } }; }
      catch (_) { throw new Error('UTF-8形式のテキストで保存し直してください。'); }
    }
    let result;
    try { result = extractText(documentXML(bytes), { lenient: true }); }
    catch (error) { if (!/[ぁ-んァ-ン一-龥]/.test(error.message)) throw invalid(); throw error; }
    return { filename, text: result.text, skipped: result.skipped };
  }
  const PACK_LIMIT = 50 * 1024 * 1024;
  const PACK_IMAGE = /\.(png|jpe?g|webp|gif)$/i;
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  /** 問題集パック（.zip）：問題のJSON 1つと画像ファイル。画像はFileとして返し、取り込み側で縮小・埋め込みする。 */
  async function readPack(file) {
    const filename = file.name || '問題集.zip';
    if (file.size > PACK_LIMIT) throw new Error('問題集パック（.zip）は50 MiB以下にしてください。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let zip;
    try { zip = readZip(bytes, { legacyNames: true }); } catch (_) { throw new Error('ZIPファイルを読み取れません。作り直してください。'); }
    // Mac's "__MACOSX/" and "._name" entries are metadata, not content.
    const names = [...zip.entries.keys()].filter((name) => !name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(name));
    const jsons = names.filter((name) => /\.json$/i.test(name));
    if (jsons.length !== 1) throw new Error(jsons.length ? 'ZIPの中に問題集のJSONが複数あります。1つにしてください。' : 'ZIPの中に問題集のJSON（questions.json など）がありません。');
    const images = names.filter((name) => PACK_IMAGE.test(name));
    const folder = jsons[0].includes('/') ? jsons[0].slice(0, jsons[0].lastIndexOf('/') + 1) : '';
    if (images.length > 300) throw new Error('ZIPの中の画像は300枚までにしてください。');
    // Low-level inflate errors (English) and the Word-specific message both mean a damaged ZIP here.
    const broken = (error) => /Word/.test(error.message) || !/[ぁ-んァ-ン一-龥]/.test(error.message) ? new Error('ZIPファイルが壊れています。作り直してください。') : error;
    let text, total = 0;
    try { text = utf8.decode(extract(bytes, zip, zip.entries.get(jsons[0]), TEXT_LIMIT, '問題集のJSONは2 MiB以下にしてください。')); }
    catch (error) { if (error instanceof TypeError || error instanceof RangeError) throw new Error('JSONはUTF-8で保存してください。'); throw broken(error); }
    const files = images.map((name) => {
      let data;
      try { data = extract(bytes, zip, zip.entries.get(name), 20 * 1024 * 1024, `画像が大きすぎます：${name}`); } catch (error) { throw broken(error); }
      total += data.length;
      if (total > 200 * 1024 * 1024) throw new Error('ZIPの中の画像の合計が大きすぎます。');
      const base = name.split('/').pop();
      const type = IMAGE_TYPES[base.split('.').pop().toLowerCase()];
      // Paths in the JSON are relative to the JSON's folder (Finder's "Compress" adds a top folder).
      const relative = folder && name.startsWith(folder) ? name.slice(folder.length) : name;
      return Object.assign(new File([data], base, { type }), { path: relative });
    });
    return { filename, text, images: files };
  }
  return { read, readForGeneration, readReport, readPack };
})();
