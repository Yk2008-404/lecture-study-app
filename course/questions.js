/**
 * 問題入りの版の questions.js（tools/build-course.cjs が通常の questions.js と差し替える）。問題のまとめ（summary/）も同じものを使う。
 * 合言葉で questions.enc.json を復号し、検査してから組込問題（QUESTIONS）として app.js に渡す。
 *
 * 形式 v2：問題は公開のたびに作る鍵（データ鍵）で AES-256-GCM 暗号化し、データ鍵を合言葉ごとの「鍵の枠」に入れる。
 * 枠の鍵は合言葉から PBKDF2-SHA256 で作る。枠は通常（member）とゲスト（guest、期限つき）。
 * ゲストは期限を過ぎるとこの端末でログアウトし、期限切れの枠は次の公開で取り除かれる（同じ合言葉では開けなくなる）。
 * 合言葉を知らない人に中身を見せないためのもので、合言葉を知っている人どうしの間の秘密は守れない。
 */
const QUESTIONS = [];
window.studyBuiltInsReady = (() => {
  'use strict';
  // 学習アプリ（course/）からも、まとめ（course/summary/）からも同じデータを読む。
  // questions.enc.json（v1）は、前の版の入口のために移行期間だけ並べて置く。この入口は v2 を読む。
  const DATA_URL = new URL('questions.v2.json', document.currentScript ? document.currentScript.src : window.location.href).href;
  const CACHE_NAME = 'course-app-questions.v1';
  const KEY_STORE = 'course-app.key.v1';
  const MAX_CHARS = 16 * 1024 * 1024;
  const RELOAD_FLAG = 'course-app.reloaded-for-update';
  const $ = (id) => document.getElementById(id);
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const base64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const object = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const fail = (message) => Object.assign(new Error(message), { shown: true });
  const b64 = (s) => typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  const dateLabel = (iso) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' });
  const expired = (slot) => slot.kind === 'guest' && !(Date.parse(slot.expiresAt) > Date.now());

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

  /** 暗号化データの外枠の検査。v1（合言葉の鍵で直接暗号化）も読む。 */
  function sealedOf(text) {
    if (typeof text !== 'string' || text.length > MAX_CHARS) throw fail('問題データが大きすぎます。');
    let sealed;
    try { sealed = JSON.parse(text); } catch (_) { throw fail('問題データの形式が正しくありません。'); }
    const iterations = (n) => Number.isInteger(n) && n >= 100000 && n <= 5000000;
    if (object(sealed) && sealed.v === 1 && iterations(sealed.iterations) && b64(sealed.salt) && b64(sealed.iv) && b64(sealed.data)) {
      return { iterations: sealed.iterations, data: { iv: sealed.iv, ct: sealed.data }, slots: [{ kind: 'member', salt: sealed.salt, direct: true }] };
    }
    const slotOk = (s) => object(s) && (s.kind === 'member' || (s.kind === 'guest' && typeof s.expiresAt === 'string' && !Number.isNaN(Date.parse(s.expiresAt))))
      && b64(s.salt) && b64(s.iv) && b64(s.key);
    if (!object(sealed) || sealed.v !== 2 || !iterations(sealed.iterations) || !object(sealed.data) || !b64(sealed.data.iv) || !b64(sealed.data.ct)
      || !Array.isArray(sealed.slots) || !sealed.slots.length || sealed.slots.length > 200 || !sealed.slots.every(slotOk)) throw new Error('format');
    return sealed;
  }
  /** 最新の問題データ。つながらないときは前回読み込んだもの（オフライン用）。 */
  async function load() {
    let text = null;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
      if (response.ok) text = await response.text();
    } catch (_) { /* 下で保存済みのものを使う */ }
    if (text !== null) {
      try { await (await caches.open(CACHE_NAME)).put(DATA_URL, new Response(text, { headers: { 'Content-Type': 'application/json' } })); } catch (_) { /* 次回もオンラインなら読める */ }
    } else {
      try { const saved = await (await caches.open(CACHE_NAME)).match(DATA_URL); if (saved) text = await saved.text(); } catch (_) { /* 下の案内を出す */ }
      if (text === null) throw fail('問題データを読み込めませんでした。インターネットにつないでから開き直してください。');
    }
    try { return sealedOf(text); }
    catch (error) {
      if (error.shown) throw error;
      // 前の版のアプリが新しい形式を読めない場合に備えて、待機中の新しい版へ切り替える。
      if (await updateApp()) return new Promise(() => {});
      throw fail('問題データの形式が正しくありません。アプリの画面（タブ）をすべて閉じてから、開き直してください。');
    }
  }
  function remembered() {
    try { const saved = JSON.parse(window.localStorage.getItem(KEY_STORE) || 'null'); return object(saved) && b64(saved.salt) && b64(saved.key) ? saved : null; }
    catch (_) { return null; }
  }
  function forget() { try { window.localStorage.removeItem(KEY_STORE); } catch (_) { /* 保存していない */ } }
  async function derive(passphrase, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.trim().normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations }, material, 256);
  }
  async function decrypt(raw, iv, ct, aad) {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) }, key, bytes(ct));
  }
  const slotAad = (slot) => `course-slot:${slot.kind}:${slot.expiresAt || ''}`;
  /** 枠の鍵で問題を開く。開けなければ null（合言葉の違い・改ざん）。 */
  async function openWith(slotKey, slot, sealed) {
    try {
      const dataKey = slot.direct ? slotKey : await decrypt(slotKey, slot.iv, slot.key, slotAad(slot));
      return new TextDecoder().decode(await decrypt(dataKey, sealed.data.iv, sealed.data.ct));
    } catch (_) { return null; }
  }
  /** 復号した内容を、取り込みと同じ検査にかける。1件でも不正なら使わない。 */
  function questionsOf(plain) {
    let data;
    try { data = JSON.parse(plain); } catch (_) { throw fail('問題データの形式が正しくありません。'); }
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
  /** 開いた内容を検査する。前の版で読めない場合は新しい版へ切り替える。 */
  async function checked(plain) {
    try { return questionsOf(plain); }
    catch (error) {
      if (error.shown && await updateApp()) return new Promise(() => {});
      if (error.shown) error.message += ' アプリの画面（タブ）をすべて閉じてから、開き直してください。';
      throw error;
    }
  }
  function stop(message) {
    $('course-gate').hidden = false; $('course-loading').hidden = true; $('course-form').hidden = true;
    $('course-error').textContent = message; $('course-error').hidden = false;
    return new Promise(() => {}); // 問題がないまま学習画面を出さない
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
          // 合言葉に合う枠を探す（枠ごとにソルトが違う）。期限切れのゲスト枠は使わない。
          let found = null, expiredMatch = false;
          for (const slot of sealed.slots) {
            const slotKey = await derive(input.value, slot.salt, sealed.iterations);
            const plain = await openWith(slotKey, slot, sealed);
            if (plain === null) continue;
            if (expired(slot)) { expiredMatch = true; continue; }
            found = { slot, slotKey, plain }; break;
          }
          if (!found) {
            error.textContent = expiredMatch ? 'このゲスト用の合言葉は期限が切れています。' : '合言葉が違います。「表示」を押して、入力した文字を確かめてください。';
            error.hidden = false; input.select(); return;
          }
          const result = await checked(found.plain);
          if ($('course-remember').checked) {
            try {
              window.localStorage.setItem(KEY_STORE, JSON.stringify({ salt: found.slot.salt, iterations: sealed.iterations, key: base64(found.slotKey),
                kind: found.slot.kind, ...(found.slot.expiresAt ? { expiresAt: found.slot.expiresAt } : {}) }));
            } catch (_) { /* 次回も入力する */ }
          } else forget();
          input.value = '';
          gate.hidden = true;
          resolve({ ...result, slot: found.slot });
        } catch (e) {
          error.textContent = e.shown ? e.message : '問題を開けませんでした。開き直してください。';
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
    catch (error) { return stop(error.message); }
    let result = null, message = '';
    const saved = remembered();
    if (saved) {
      const slot = sealed.slots.find((s) => s.salt === saved.salt);
      if (!slot || saved.iterations !== sealed.iterations) {
        forget();
        message = saved.kind === 'guest' ? 'ゲストの期限が切れました。' : '合言葉が変わりました。新しい合言葉を入力してください。';
      } else if (expired(slot)) {
        forget();
        message = 'ゲストの期限が切れました。';
      } else {
        const plain = await openWith(bytes(saved.key), slot, sealed);
        if (plain === null) { forget(); message = '合言葉が変わりました。新しい合言葉を入力してください。'; }
        else {
          try { result = { ...(await checked(plain)), slot }; }
          catch (error) { return stop(error.shown ? error.message : '問題を開けませんでした。開き直してください。'); }
        }
      }
    }
    if (!result) result = await showGate(sealed, message);
    try { window.sessionStorage.removeItem(RELOAD_FLAG); } catch (_) { /* なくてもよい */ }
    QUESTIONS.push(...result.questions);
    $('course-gate').hidden = true;
    const guestUntil = result.slot.kind === 'guest' ? result.slot.expiresAt : null;
    window.studyCourseInfo = { updatedAt: result.updatedAt, guestUntil };
    const updated = $('course-updated');
    if (updated) updated.textContent = (result.updatedAt ? `問題の更新：${result.updatedAt}` : '') + (guestUntil ? `　ゲスト（${dateLabel(guestUntil)}まで）` : '');
    const forgetButton = $('course-forget');
    if (forgetButton) forgetButton.onclick = () => { forget(); window.location.reload(); };
    // ゲストが開いたまま期限を迎えたら、その時点でログアウトする。
    if (guestUntil) {
      const wait = Date.parse(guestUntil) - Date.now();
      if (wait < 2147483647) setTimeout(() => { forget(); window.location.reload(); }, Math.max(0, wait));
    }
  })();
})();
