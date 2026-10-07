/** QRコード・リンクでの問題の共有。問題はリンクの「#」より後ろに入れ、サーバーへは送らない。 */
const QuestionShare = (() => {
  'use strict';
  const BASE = 'https://yk2008-404.github.io/lecture-study-app/';
  const VERSION = 1;
  // 1枚のQRコードに入れる文字数。画面のQRコードをスマホで読み取りやすい大きさ（バージョン29前後）に抑える。
  const CHUNK = 1500;
  const MAX_PARTS = 10;
  const PARTS_KEY = 'quiz-app.share-parts.v1';
  const KEEP_MS = 24 * 60 * 60 * 1000;
  const LINK = /#share=(\d+)\.([A-Za-z0-9]{8})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]+)/;

  function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  /** 複数枚のQRコードを同じ共有としてまとめるための目印。 */
  function shareId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const random = new Uint8Array(8);
    crypto.getRandomValues(random);
    return Array.from(random, (n) => alphabet[n % alphabet.length]).join('');
  }

  /** 共有できる問題（画像なし）だけを使い、解説を外す指定にも対応する。 */
  function packFor(subject, questions, withExplanation) {
    return {
      schemaVersion: QuestionPacks.SCHEMA_VERSION, subject,
      questions: questions.map((q) => {
        const copy = JSON.parse(JSON.stringify(q));
        if (!withExplanation) delete copy.explanation;
        return copy;
      }),
    };
  }
  const shareable = (q) => !q.image;

  /** 問題セットを圧縮し、QRコード1枚ずつのリンクに分ける。 */
  function encode(pack) {
    const compressed = fflate.deflateSync(new TextEncoder().encode(JSON.stringify(pack)), { level: 9 });
    const data = toBase64Url(compressed);
    const total = Math.max(1, Math.ceil(data.length / CHUNK));
    const id = shareId();
    const links = [];
    for (let i = 0; i < total; i++) links.push(`${BASE}#share=${VERSION}.${id}.${i + 1}.${total}.${data.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    return { id, links, parts: total, bytes: compressed.length, fits: total <= MAX_PARTS };
  }

  function parseLink(text) {
    const m = LINK.exec(String(text || ''));
    if (!m) return null;
    const [, version, id, index, total, data] = m;
    const n = Number(total), i = Number(index);
    if (Number(version) !== VERSION || n < 1 || n > MAX_PARTS || i < 1 || i > n || data.length > CHUNK) return null;
    return { id, index: i, total: n, data };
  }
  function findLinks(text) {
    return String(text || '').split(/\s+/).map(parseLink).filter(Boolean);
  }

  function readParts() {
    try {
      const value = JSON.parse(window.localStorage.getItem(PARTS_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function writeParts(parts) {
    try {
      if (Object.keys(parts).length) window.localStorage.setItem(PARTS_KEY, JSON.stringify(parts));
      else window.localStorage.removeItem(PARTS_KEY);
    } catch (_) { /* 保存できない環境では、このページで読んだ分だけで組み立てる */ }
  }

  /**
   * 読み取ったリンクを集める。複数枚のQRコードは、別々に読み取っても（別のタブで開いても）まとめる。
   * 返り値: { done: true, text } または { done: false, have, total, missing }
   */
  function collect(found, memory = {}) {
    const now = Date.now();
    const parts = Object.assign(readParts(), memory);
    for (const [id, entry] of Object.entries(parts)) if (!entry || typeof entry !== 'object' || now - entry.at > KEEP_MS) delete parts[id];
    let latest = null;
    for (const link of found) {
      const entry = parts[link.id] && parts[link.id].total === link.total ? parts[link.id] : { total: link.total, at: now, data: {} };
      entry.data[link.index] = link.data;
      entry.at = now;
      parts[link.id] = entry;
      latest = link.id;
    }
    if (!latest) return null;
    const entry = parts[latest];
    const missing = [];
    for (let i = 1; i <= entry.total; i++) if (typeof entry.data[i] !== 'string') missing.push(i);
    if (missing.length) {
      writeParts(parts); memory[latest] = entry;
      return { done: false, have: entry.total - missing.length, total: entry.total, missing };
    }
    delete parts[latest]; delete memory[latest];
    writeParts(parts);
    let joined = '';
    for (let i = 1; i <= entry.total; i++) joined += entry.data[i];
    return { done: true, text: decode(joined) };
  }

  function decode(data) {
    let bytes;
    try { bytes = fflate.inflateSync(fromBase64Url(data)); }
    catch (_) { throw new Error('共有された問題を読み取れませんでした。QRコードをもう一度読み取ってください。'); }
    if (bytes.length > QuestionPacks.MAX_BYTES) throw new Error('共有された問題が大きすぎます。');
    return new TextDecoder().decode(bytes);
  }

  /** QRコードをSVGで描く（外部への通信なし）。 */
  function qrSvg(text) {
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    const count = qr.getModuleCount(), margin = 4, size = count + margin * 2;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    const background = document.createElementNS(NS, 'rect');
    background.setAttribute('width', size); background.setAttribute('height', size); background.setAttribute('fill', '#fff');
    let d = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#000');
    svg.append(background, path);
    return svg;
  }

  return { BASE, MAX_PARTS, packFor, shareable, encode, parseLink, findLinks, collect, decode, qrSvg, _test: { toBase64Url, fromBase64Url, PARTS_KEY, CHUNK } };
})();
