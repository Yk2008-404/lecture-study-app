/**
 * 問題のまとめ（course/summary/）。問題入りの学習アプリと同じ暗号化データ（../questions.enc.json）と合言葉を使い、
 * 全問題を科目・講義回ごとに一覧にする。覚えた鍵（course-app.key.v1）も学習アプリと共有する。
 * 問題は取り込みと同じ検査（QuestionPacks.validate）を通してから、textContent だけで表示する。
 */
(() => {
  'use strict';
  const DATA_URL = '../questions.enc.json';
  const KEY_STORE = 'course-app.key.v1';
  const HIDE_STORE = 'course-app.summary-hide.v1';
  const MAX_CHARS = 16 * 1024 * 1024;
  const RELOAD_FLAG = 'course-app.reloaded-for-update';
  const $ = (id) => document.getElementById(id);
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const base64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const object = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const fail = (message) => Object.assign(new Error(message), { shown: true });
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };

  /**
   * 問題データを読めないのは、前の版のアプリが保存されたまま新しい問題が届いたときに起こりうる。
   * 学習を始める前なので、待機中の新しい版があれば切り替えて開き直す（1回だけ）。切り替えたら true。
   */
  async function updateApp() {
    try {
      if (!navigator.serviceWorker || window.sessionStorage.getItem(RELOAD_FLAG)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return false;
      await registration.update().catch(() => {});
      const worker = registration.waiting || registration.installing;
      if (!worker) return false;
      window.sessionStorage.setItem(RELOAD_FLAG, '1');
      await new Promise((resolve) => {
        const done = () => { if (worker.state === 'activated' || worker.state === 'redundant') resolve(); };
        worker.addEventListener('statechange', done);
        worker.postMessage({ type: 'activate-before-start' });
        setTimeout(resolve, 8000);
        done();
      });
      window.location.reload();
      return true;
    } catch (_) { return false; }
  }
  function sealedOf(text) {
    if (typeof text !== 'string' || text.length > MAX_CHARS) throw fail('問題データが大きすぎます。');
    const sealed = JSON.parse(text);
    const b64 = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
    if (!object(sealed) || sealed.v !== 1 || !Number.isInteger(sealed.iterations) || sealed.iterations < 100000 || sealed.iterations > 5000000
      || !b64(sealed.salt) || !b64(sealed.iv) || !b64(sealed.data)) throw fail('問題データの形式が正しくありません。');
    return sealed;
  }
  async function load() {
    let response;
    try { response = await fetch(DATA_URL, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }); }
    catch (_) { throw fail('問題データを読み込めませんでした。インターネットにつないでから開き直してください。'); }
    if (!response.ok) throw fail('問題データを読み込めませんでした。時間をおいて開き直してください。');
    return sealedOf(await response.text());
  }
  function rememberedKey(sealed) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY_STORE) || 'null');
      return object(saved) && saved.salt === sealed.salt && saved.iterations === sealed.iterations && typeof saved.key === 'string' ? saved.key : null;
    } catch (_) { return null; }
  }
  function forget() { try { window.localStorage.removeItem(KEY_STORE); } catch (_) { /* 保存していない */ } }
  async function derive(passphrase, sealed) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.trim().normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(sealed.salt), iterations: sealed.iterations }, material, 256);
  }
  async function open(raw, sealed) {
    try {
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv) }, key, bytes(sealed.data)));
    } catch (_) { return null; }
  }
  function questionsOf(plain) {
    const data = JSON.parse(plain);
    if (!object(data) || data.v !== 1 || !Array.isArray(data.questions) || !data.questions.length) throw fail('問題データの形式が正しくありません。');
    const subjects = new Map();
    for (const q of data.questions) {
      if (!object(q) || typeof q.subject !== 'string') throw fail('問題データの形式が正しくありません。');
      if (!subjects.has(q.subject)) subjects.set(q.subject, []);
      subjects.get(q.subject).push(q);
    }
    const accepted = [];
    for (const [subject, questions] of subjects) {
      const result = QuestionPacks.validate({ schemaVersion: QuestionPacks.SCHEMA_VERSION, subject, questions }, accepted);
      if (!result.ok) throw fail(`問題データに誤りがあります（${subject}）。`);
      accepted.push(...result.pack.questions);
    }
    return { questions: accepted, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '' };
  }
  function ask(sealed, message) {
    $('loading').hidden = true; $('ask').hidden = false; $('form').hidden = false;
    const input = $('passphrase'), error = $('error');
    error.textContent = message || ''; error.hidden = !message;
    input.focus();
    $('show').onclick = () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      $('show').textContent = visible ? '隠す' : '表示';
      $('show').setAttribute('aria-pressed', String(visible));
    };
    return new Promise((resolve) => {
      let busy = false;
      $('form').onsubmit = async (event) => {
        event.preventDefault();
        if (busy || !input.value.trim()) return;
        busy = true; error.hidden = true;
        try {
          const raw = await derive(input.value, sealed);
          const plain = await open(raw, sealed);
          if (plain === null) { error.textContent = '合言葉が違います。「表示」を押して、入力した文字を確かめてください。'; error.hidden = false; input.select(); return; }
          const result = questionsOf(plain);
          if ($('remember').checked) {
            try { window.localStorage.setItem(KEY_STORE, JSON.stringify({ salt: sealed.salt, iterations: sealed.iterations, key: base64(raw) })); } catch (_) { /* 次回も入力する */ }
          }
          input.value = '';
          resolve(result);
        } catch (e) {
          if (e.shown && await updateApp()) return;
          error.textContent = e.shown ? `${e.message} 学習アプリとこのページの画面（タブ）をすべて閉じてから、開き直してください。` : '問題を開けませんでした。開き直してください。'; error.hidden = false;
        } finally { busy = false; }
      };
    });
  }

  // ---- 一覧の表示 ----
  const lectureOf = (q) => QuestionPacks.lecture(q) || 0;
  const groupKey = (q) => `${q.subject}\u0000${lectureOf(q)}`;
  function card(q, index) {
    const item = el('article', undefined, 'card');
    item.dataset.group = groupKey(q);
    const location = typeof q.source.location === 'string' ? q.source.location : `${q.source.location}ページ`;
    item.append(el('p', `問${index} ・ ${q.questionType} ・ ${location}`, 'meta'));
    item.append(el('p', q.text, 'text'));
    if (q.image) { const image = el('img'); image.src = q.image.src; image.alt = q.image.alt; item.append(image); }
    if (q.questionType === '選択肢' || q.questionType === '想起' || q.questionType === QuestionPacks.MULTI) {
      const list = el('ol');
      q.choices.forEach((choice, i) => {
        const li = el('li', choice);
        if (QuestionPacks.correctIndexes(q).includes(i)) { li.classList.add('is-correct'); li.append(el('span', '（正解）', 'is-correct-mark')); }
        list.append(li);
      });
      item.append(list);
    }
    const answer = q.questionType === '記述' ? `模範解答：${q.answer}` : `正解：${QuestionPacks.answerText(q)}`;
    const area = el('div', undefined, 'answer-area');
    area.append(el('span', answer, 'answer'));
    if (q.explanation) area.append(el('p', q.explanation, 'explanation'));
    item.append(area);
    const reveal = el('button', '答えを見る', 'reveal');
    reveal.type = 'button';
    reveal.addEventListener('click', () => item.classList.add('revealed'));
    item.append(reveal);
    item.dataset.search = [q.text, ...(q.choices || []), typeof q.answer === 'string' ? q.answer : '', q.explanation || '', location].join('\n').toLowerCase();
    return item;
  }
  function render({ questions, updatedAt }) {
    const list = $('list');
    const subjects = [...new Set(questions.map((q) => q.subject))];
    const filter = $('lecture-filter');
    filter.replaceChildren(el('option', 'すべての回'));
    filter.firstChild.value = '';
    const toc = el('ul', undefined, 'toc no-print');
    for (const subject of subjects) {
      const inSubject = questions.filter((q) => q.subject === subject);
      const lectures = [...new Set(inSubject.map(lectureOf))].sort((a, b) => (a || Infinity) - (b || Infinity));
      const heading = el('h2', `${subject}（${inSubject.length}問）`);
      list.append(heading);
      for (const lecture of lectures) {
        const group = inSubject.filter((q) => lectureOf(q) === lecture);
        const section = el('section');
        section.dataset.group = groupKey(group[0]);
        section.id = `s-${subjects.indexOf(subject)}-${lecture}`;
        section.append(el('h3', `${QuestionPacks.lectureLabel(lecture)}（${group.length}問）`));
        group.forEach((q, i) => section.append(card(q, i + 1)));
        list.append(section);
        const option = el('option', `${subject} ${QuestionPacks.lectureLabel(lecture)}`);
        option.value = section.dataset.group;
        filter.append(option);
        const link = el('a', `${subjects.length > 1 ? subject + ' ' : ''}${QuestionPacks.lectureLabel(lecture)}`);
        link.href = `#${section.id}`;
        const li = el('li'); li.append(link); toc.append(li);
      }
    }
    list.prepend(toc);
    $('summary-count').textContent = `全${questions.length}問`;
    if (updatedAt) $('summary-updated').textContent = `（${updatedAt} 更新）`;
    const apply = () => {
      const words = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const group = filter.value;
      let shown = 0;
      list.querySelectorAll('section').forEach((section) => {
        let visible = 0;
        section.querySelectorAll('.card').forEach((item) => {
          const ok = (!group || item.dataset.group === group) && words.every((w) => item.dataset.search.includes(w));
          item.hidden = !ok; if (ok) visible++;
        });
        section.hidden = !visible; shown += visible;
      });
      list.querySelectorAll('h2').forEach((h) => {
        let next = h.nextElementSibling, any = false;
        while (next && next.tagName === 'SECTION') { if (!next.hidden) any = true; next = next.nextElementSibling; }
        h.hidden = !any;
      });
      $('no-match').hidden = shown > 0;
    };
    $('search').addEventListener('input', apply);
    filter.addEventListener('change', apply);
    const hide = $('hide-answers');
    try { hide.checked = window.localStorage.getItem(HIDE_STORE) === '1'; } catch (_) { /* 既定は表示 */ }
    const applyHide = () => {
      list.classList.toggle('hidden-answers', hide.checked);
      list.querySelectorAll('.card.revealed').forEach((item) => item.classList.remove('revealed'));
      try { window.localStorage.setItem(HIDE_STORE, hide.checked ? '1' : '0'); } catch (_) { /* この画面の間だけ */ }
    };
    hide.addEventListener('change', applyHide);
    applyHide();
    $('print').addEventListener('click', () => window.print());
    $('gate').hidden = true;
    $('content').hidden = false;
  }

  (async () => {
    try {
      const sealed = await load();
      let result = null;
      const key = rememberedKey(sealed);
      if (key) {
        const plain = await open(bytes(key), sealed);
        if (plain === null) forget();
        else {
          try { result = questionsOf(plain); }
          catch (error) { if (error.shown && await updateApp()) return; throw error; }
        }
      }
      if (!result) result = await ask(sealed, key ? '合言葉が変わりました。新しい合言葉を入力してください。' : '');
      try { window.sessionStorage.removeItem(RELOAD_FLAG); } catch (_) { /* なくてもよい */ }
      render(result);
    } catch (error) {
      $('loading').hidden = true;
      $('error').textContent = error.shown ? error.message : '問題を開けませんでした。開き直してください。';
      $('error').hidden = false;
    }
  })();
})();
