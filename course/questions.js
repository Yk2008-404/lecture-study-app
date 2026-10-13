/**
 * 問題入りの版の questions.js（tools/build-course.cjs が通常の questions.js と差し替える）。
 * 合言葉で questions.enc.json を復号し、検査してから組込問題（QUESTIONS）として app.js に渡す。
 * 暗号は AES-256-GCM、鍵は合言葉から PBKDF2-SHA256 で作る。合言葉を知らない人に中身を見せないためのもので、
 * 合言葉を知っている人どうしの間の秘密は守れない。
 */
const QUESTIONS = [];
window.studyBuiltInsReady = (() => {
  'use strict';
  const DATA_URL = 'questions.enc.json';
  const CACHE_NAME = 'course-app-questions.v1';
  const KEY_STORE = 'course-app.key.v1';
  const MAX_CHARS = 16 * 1024 * 1024;
  const RELOAD_FLAG = 'course-app.reloaded-for-update';
  const $ = (id) => document.getElementById(id);
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const base64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const object = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const fail = (message) => Object.assign(new Error(message), { shown: true });

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
  /** 最新の問題データ。つながらないときは前回読み込んだもの（オフライン用）。 */
  async function load() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error(String(response.status));
      const text = await response.text();
      const sealed = sealedOf(text);
      try { await (await caches.open(CACHE_NAME)).put(DATA_URL, new Response(text, { headers: { 'Content-Type': 'application/json' } })); } catch (_) { /* 次回もオンラインなら読める */ }
      return sealed;
    } catch (error) {
      if (error.shown) throw error;
      try {
        const saved = await (await caches.open(CACHE_NAME)).match(DATA_URL);
        if (saved) return sealedOf(await saved.text());
      } catch (_) { /* 下の案内を出す */ }
      throw fail('問題データを読み込めませんでした。インターネットにつないでから開き直してください。');
    }
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
  /** 復号できなければ null（合言葉の違い）。 */
  async function open(raw, sealed) {
    try {
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv) }, key, bytes(sealed.data)));
    } catch (_) { return null; }
  }
  /** 復号した内容を、取り込みと同じ検査にかける。1件でも不正なら使わない。 */
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
      if (!result.ok) throw fail(`問題データに誤りがあります（${subject}：${result.errors[0].path} ${result.errors[0].reason}）。`);
      accepted.push(...result.pack.questions);
    }
    if (new Set(accepted.map((q) => q.id)).size !== accepted.length) throw fail('問題データに同じIDの問題があります。');
    return { questions: accepted, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '' };
  }
  function showGate(sealed, message) {
    const gate = $('course-gate'), form = $('course-form'), input = $('course-passphrase'), error = $('course-error'), show = $('course-show');
    gate.hidden = false;
    $('course-loading').hidden = true;
    $('course-ask').hidden = false;
    form.hidden = false;
    error.textContent = message || '';
    error.hidden = !message;
    input.focus();
    show.onclick = () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      show.textContent = visible ? '隠す' : '表示';
      show.setAttribute('aria-pressed', String(visible));
      input.focus();
    };
    return new Promise((resolve) => {
      let busy = false;
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (busy || !input.value.trim()) return;
        busy = true; form.setAttribute('aria-busy', 'true'); error.hidden = true;
        try {
          const raw = await derive(input.value, sealed);
          const plain = await open(raw, sealed);
          if (plain === null) { error.textContent = '合言葉が違います。「表示」を押して、入力した文字を確かめてください。'; error.hidden = false; input.select(); return; }
          const result = questionsOf(plain);
          if ($('course-remember').checked) {
            try { window.localStorage.setItem(KEY_STORE, JSON.stringify({ salt: sealed.salt, iterations: sealed.iterations, key: base64(raw) })); } catch (_) { /* 次回も入力する */ }
          } else forget();
          input.value = '';
          gate.hidden = true;
          resolve(result);
        } catch (e) {
          if (e.shown && await updateApp()) return;
          error.textContent = e.shown ? `${e.message} アプリの画面（タブ）をすべて閉じてから、開き直してください。` : '問題を開けませんでした。開き直してください。';
          error.hidden = false;
        } finally { busy = false; form.removeAttribute('aria-busy'); }
      };
    });
  }

  return (async () => {
    // この版の questions.js は question-packs.js より先に読み込まれる。検査に使うので、全スクリプトの読み込みを待つ。
    if (document.readyState === 'loading') await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    let sealed;
    try { sealed = await load(); }
    catch (error) {
      $('course-gate').hidden = false; $('course-loading').hidden = true; $('course-form').hidden = true;
      $('course-error').textContent = error.message; $('course-error').hidden = false;
      return new Promise(() => {}); // 問題がないまま学習画面を出さない
    }
    let result = null;
    const key = rememberedKey(sealed);
    if (key) {
      const plain = await open(bytes(key), sealed);
      if (plain === null) forget();
      else {
        try { result = questionsOf(plain); }
        catch (error) {
          if (await updateApp()) return new Promise(() => {});
          error.message += ' アプリの画面（タブ）をすべて閉じてから、開き直してください。';
          $('course-gate').hidden = false; $('course-loading').hidden = true; $('course-form').hidden = true; $('course-error').textContent = error.message; $('course-error').hidden = false; return new Promise(() => {}); }
      }
    }
    if (!result) result = await showGate(sealed, key ? '合言葉が変わりました。新しい合言葉を入力してください。' : '');
    try { window.sessionStorage.removeItem(RELOAD_FLAG); } catch (_) { /* なくてもよい */ }
    QUESTIONS.push(...result.questions);
    $('course-gate').hidden = true;
    const updated = $('course-updated');
    if (updated && result.updatedAt) updated.textContent = `問題の更新：${result.updatedAt}`;
    const forgetButton = $('course-forget');
    if (forgetButton) forgetButton.onclick = () => { forget(); window.location.reload(); };
  })();
})();
