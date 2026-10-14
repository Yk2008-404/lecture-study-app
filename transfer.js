/**
 * 学習記録の引き継ぎ（前のURL → 新しいURL）で、両方のページが使う共通の決まり。
 * 記録は localStorage の決まった名前（下の PREFIXES）だけを、{ v, at, items } の形で渡す。
 * 圧縮は同梱の fflate（deflate）、URLでは「#data=」以降に base64url で入れる（サーバーへは送られない）。
 */
const StudyTransfer = (() => {
  'use strict';
  const PREFIXES = ['quiz-app.', 'study-app.', 'course-app.', 'course-study-app.'];
  // 前のURLだけで意味があるもの（問題入りサイトの暗号の鍵など）は渡さない。
  const SKIP = new Set(['course-app.key.v1', 'course-app.reloaded-for-update', 'course-app.logout-reason']);
  const MAX_BYTES = 4.5 * 1024 * 1024;
  const URL_LIMIT = 1500000; // これより長いときはファイルで渡す
  const wanted = (key) => PREFIXES.some((p) => key.startsWith(p)) && !SKIP.has(key);
  const enc = new TextEncoder(), dec = new TextDecoder();

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
  /** この端末の記録を集める。 */
  function collect(storage) {
    const items = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && wanted(key)) items[key] = storage.getItem(key);
    }
    return { v: 1, at: new Date().toISOString(), items };
  }
  const pack = (data) => toBase64Url(fflate.deflateSync(enc.encode(JSON.stringify(data)), { level: 9 }));
  /** 受け取った記録を検査する。おかしければ例外。 */
  function check(data) {
    if (!data || typeof data !== 'object' || data.v !== 1 || !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) throw new Error('引き継ぎのデータの形式が正しくありません。');
    let size = 0;
    const items = {};
    for (const [key, value] of Object.entries(data.items)) {
      if (!wanted(key)) throw new Error(`引き継げない項目があります（${key.slice(0, 40)}）。`);
      if (typeof value !== 'string') throw new Error('引き継ぎのデータの形式が正しくありません。');
      size += key.length + value.length;
      items[key] = value;
    }
    if (size * 2 > MAX_BYTES) throw new Error('引き継ぐ記録が大きすぎます。');
    return { at: typeof data.at === 'string' ? data.at : '', items };
  }
  function unpack(text) {
    let data;
    try { data = JSON.parse(dec.decode(fflate.inflateSync(fromBase64Url(text)))); } catch (_) { throw new Error('引き継ぎのデータを読めませんでした。前のURLの画面からやり直してください。'); }
    return check(data);
  }
  function fromFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('引き継ぎのファイルを読めませんでした。'); }
    return check(data);
  }
  /** 中身の目安（科目数・問題数・回答数）。表示用。 */
  function summary(items) {
    const parse = (key) => { try { return JSON.parse(items[key]); } catch (_) { return null; } };
    const count = { subjects: new Set(), questions: 0, answers: 0, keys: Object.keys(items).length };
    for (const prefix of ['quiz-app.', 'course-app.']) {
      const imports = parse(`${prefix}imports.v1`);
      if (imports && Array.isArray(imports.questions)) { count.questions += imports.questions.length; imports.questions.forEach((q) => q && count.subjects.add(q.subject)); }
      if (imports && Array.isArray(imports.answers)) count.answers += imports.answers.length;
      const answers = parse(`${prefix}answers.v1`);
      if (Array.isArray(answers)) count.answers += answers.length;
    }
    return { keys: count.keys, subjects: count.subjects.size, questions: count.questions, answers: count.answers };
  }
  return { PREFIXES, URL_LIMIT, collect, pack, unpack, fromFile, summary, wanted };
})();
