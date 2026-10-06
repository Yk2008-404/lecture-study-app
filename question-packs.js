/** 問題セットの形式・検査。DOM・保存層に依存しない。 */
const QuestionPacks = (() => {
  'use strict';
  const SCHEMA_VERSION = 1;
  const MAX_BYTES = 2 * 1024 * 1024;
  const FORMATS = ['用語→定義', '定義→用語', 'その他'];
  const TYPES = ['選択肢', '正誤', '想起'];
  const FIELDS = ['id', 'subject', 'source', 'format', 'questionType', 'text', 'choices', 'answer', 'explanation', 'importance'];
  const FORBIDDEN_IDS = ['__proto__', 'constructor', 'prototype'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const string = (s) => typeof s === 'string' && s.trim().length > 0;
  const supported = (q) => q.questionType === '選択肢' || q.questionType === '正誤';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** キー順に依存しない照合。IDは含めず、既定値の表現差を吸収する。 */
  function signature(q) {
    return JSON.stringify([
      q.subject, q.source.document, q.source.location, q.format, q.questionType,
      q.text, q.choices, q.answer, q.explanation || '', q.importance || 'B',
    ]);
  }


  /** UTF-8のSHA-256。旧問題の内容照合専用。保存・通信・権限処理は行わない。 */
  function sha256(text) {
    const k = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes = new TextEncoder().encode(text);
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes); padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (n, b) => (n >>> b) | (n << (32 - b));
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,hh].forEach((value,i) => { h[i] = (h[i] + value) >>> 0; });
    }
    return h.map(n => n.toString(16).padStart(8, '0')).join('');
  }
  const fingerprint = (q) => sha256(signature(q));

  function parse(text) {
    if (typeof text !== 'string') throw new Error('貼り付ける内容はJSONのテキストにする');
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('問題セットは2 MiB以下に分ける');
    let body = text.replace(/^\uFEFF/, '').trim();
    // 入力全体を包む単一フェンスだけを許可。文章からJSONを推測して拾わない。
    const fenced = body.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenced) body = fenced[1];
    try { return JSON.parse(body); }
    catch (error) { throw new Error(`JSONとして読み取れない: ${error.message}`); }
  }

  function validate(input, existing = [], retired = {}, reservedIds = []) {
    const errors = [];
    const add = (path, why) => { if (errors.length < 100) errors.push({ path, reason: why }); };
    let data;
    try { data = typeof input === 'string' ? parse(input) : clone(input); }
    catch (e) { return { ok: false, errors: [{ path: '問題セット', reason: e.message }] }; }
    if (!object(data)) return { ok: false, errors: [{ path: '問題セット', reason: 'JSONオブジェクトが必要' }] };
    Object.keys(data).forEach((k) => { if (!['schemaVersion', 'subject', 'questions'].includes(k)) add(k, '未対応の項目。自動で削除せず登録を中止する'); });
    if (data.schemaVersion !== SCHEMA_VERSION) add('schemaVersion', '対応する値は数値の1');
    if (!string(data.subject)) add('subject', '科目名を空でない文字列で指定する');
    if (string(data.subject) && data.subject !== data.subject.trim()) add('subject', '科目名の前後の空白を取り除く');
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      add('questions', '1問以上の配列が必要');
      return { ok: false, errors };
    }
    const seen = new Set();
    const existingIds = new Set(existing.map((q) => q.id));
    const reserved = new Set(reservedIds);
    data.questions.forEach((q, i) => {
      const prefix = `問題${i + 1}${object(q) && typeof q.id === 'string' ? ` (${q.id})` : ''}`;
      const bad = (key, why) => add(`${prefix}.${key}`, why);
      if (!object(q)) { bad('問題', 'オブジェクトが必要'); return; }
      Object.keys(q).forEach((k) => { if (!FIELDS.includes(k)) bad(k, '未対応の項目。書き出し時の情報欠落を避けるため登録を中止する'); });
      ['id', 'subject', 'format', 'questionType', 'text'].forEach((k) => { if (!string(q[k])) bad(k, '空でない文字列が必要'); });
      if (string(q.id)) {
        if (q.id !== q.id.trim() || FORBIDDEN_IDS.includes(q.id)) bad('id', '前後空白または予約済みIDは使用できない');
        if (seen.has(q.id)) bad('id', 'このセット内で重複している');
        seen.add(q.id);
        if (existingIds.has(q.id)) bad('id', '登録済みの問題と重複している。上書きは行わない');
        if (reserved.has(q.id) && !own(retired, q.id)) bad('id', '既存の学習履歴が使用しているID。別内容への再利用はできない');
      }
      if (q.subject !== data.subject) bad('subject', 'セットの科目名と完全一致させる。1セットは1科目');
      if (!FORMATS.includes(q.format)) bad('format', FORMATS.join(' / ') + ' のいずれか');
      if (!TYPES.includes(q.questionType)) bad('questionType', TYPES.join(' / ') + ' のいずれか');
      if (!object(q.source)) bad('source', 'documentとlocationを持つオブジェクトが必要');
      else {
        Object.keys(q.source).forEach((k) => { if (!['document', 'location'].includes(k)) bad(`source.${k}`, '未対応の出典項目'); });
        if (!string(q.source.document)) bad('source.document', '空でない資料名が必要');
        if (!(string(q.source.location) || (Number.isInteger(q.source.location) && q.source.location >= 1))) bad('source.location', '見出し等の文字列、または1以上のページ番号が必要');
      }
      if (!Array.isArray(q.choices) || q.choices.length < 2) bad('choices', '2つ以上の選択肢が必要（想起は保存のみ）');
      else {
        q.choices.forEach((c, j) => { if (!string(c)) bad(`choices[${j}]`, '空でない文字列が必要'); });
        if (new Set(q.choices).size !== q.choices.length) bad('choices', '同一の選択肢が重複している');
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || !Array.isArray(q.choices) || q.answer >= q.choices.length) bad('answer', '0から選択肢数−1までの整数が必要');
      if (q.questionType === '正誤' && JSON.stringify(q.choices) !== JSON.stringify(['正しい', '誤り'])) bad('choices', '正誤形式は ["正しい", "誤り"] の順で指定する');
      if (own(q, 'importance') && !['A', 'B', 'C'].includes(q.importance)) bad('importance', 'A / B / C のいずれか');
      if (own(q, 'explanation') && typeof q.explanation !== 'string') bad('explanation', '解説は文字列。不要なら項目を省略する');
    });
    if (errors.length) return { ok: false, errors };
    data.questions.forEach((q, i) => {
      if (own(retired, q.id) && retired[q.id].signature !== signature(q)) add(`問題${i + 1} (${q.id}).id`, 'このIDには別内容の履歴が残っている。同じ問題を戻す場合のみ再利用できる');
    });
    const contents = new Set(existing.filter((q) => q.subject === data.subject).map(signature));
    if (data.questions.every((q) => contents.has(signature(q)))) add('questions', '同一内容の問題セットは登録済み（IDや並び順を変えても重複登録しない）');
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], pack: data, summary: summarize(data.questions) };
  }

  function summarize(questions) {
    const summary = { total: questions.length, choice: 0, trueFalse: 0, recall: 0, playable: 0, explained: 0, sources: [] };
    const sources = new Set();
    questions.forEach((q) => {
      if (q.questionType === '選択肢') summary.choice++;
      if (q.questionType === '正誤') summary.trueFalse++;
      if (q.questionType === '想起') summary.recall++;
      if (supported(q)) summary.playable++;
      if (typeof q.explanation === 'string' && q.explanation.trim()) summary.explained++;
      const s = `${q.source.document} / ${q.source.location}`;
      if (!sources.has(s)) { sources.add(s); summary.sources.push(s); }
    });
    return summary;
  }

  function exportSubject(questions, subject) {
    const selected = questions.filter((q) => q.subject === subject);
    if (!selected.length) throw new Error('書き出せる登録問題は0問。この科目の問題セットを先に登録する');
    return { schemaVersion: SCHEMA_VERSION, subject, questions: clone(selected) };
  }
  return { SCHEMA_VERSION, MAX_BYTES, FORMATS, TYPES, parse, validate, summarize, signature, fingerprint, supported, exportSubject };
})();
