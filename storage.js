/**
 * 保存・読み出しの唯一の窓口。旧組込問題の履歴は自動削除・移動しない。
 * 登録問題・その進捗・回答履歴は1つの値にまとめる。旧キーを含む明示的削除のみ退避付きで更新する。
 * 書込み失敗を握りつぶさず、呼出元に通知する。メモリのみの成功は返さない。
 */
const Storage = (() => {
  'use strict';
  const PROGRESS_KEY = 'quiz-app.progress.v1';
  const ANSWERS_KEY = 'quiz-app.answers.v1';
  const SELECTED_KEY = 'quiz-app.selected-subjects.v1';
  const TUTORIAL_KEY = 'quiz-app.tutorial-seen.v1';
  const IMPORTS_KEY = 'quiz-app.imports.v1';
  // 2026-09-22の明示判断。形式変更3問は旧キーからだけ継承しない。
  // 登録後にimportsへ保存した新しい学習は通常どおり保持する。
  const RESTART_LEGACY_IDS = new Set(['jintai-004', 'jintai-036', 'rinsho-011']);
  const JOURNAL_KEY = 'quiz-app.answer-tx.v1';
  const KEYS = [PROGRESS_KEY, ANSWERS_KEY, SELECTED_KEY, TUTORIAL_KEY, IMPORTS_KEY, JOURNAL_KEY];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let chain = Promise.resolve();
  let builtIns = [];
  let builtinIds = new Set();
  let legacyIdentities = {};

  function fail(message, cause) {
    const error = new Error(message + (cause ? ` (${cause.name || 'Error'}: ${cause.message})` : ''));
    error.name = 'QuizStorageError';
    return error;
  }
  function backend() {
    try { return window.localStorage; }
    catch (e) { throw fail('ブラウザの保存領域にアクセスできない。保存設定を確認して再読み込みする。既存データは初期化しない', e); }
  }
  function read(key, fallback, valid) {
    let raw;
    try { raw = backend().getItem(key); }
    catch (e) { throw fail(`保存データを読み出せない: ${key}`, e); }
    if (raw === null) return clone(fallback);
    let value;
    try { value = JSON.parse(raw); }
    catch (e) { throw fail(`保存データが壊れているため上書きを中止: ${key}`, e); }
    if (valid && !valid(value)) throw fail(`保存データの形式が不正なため上書きを中止: ${key}`);
    return value;
  }
  function write(key, value) {
    try { backend().setItem(key, JSON.stringify(value)); }
    catch (e) { throw fail('保存できなかった。今回の変更は完了していない。容量・保存設定を確認して再試行する', e); }
  }
  function emptyImports() { return { version: 1, questions: [], progress: {}, answers: [], retired: {} }; }
  function imports() {
    const value = read(IMPORTS_KEY, emptyImports(), (v) => object(v) && v.version === 1 && Array.isArray(v.questions) && object(v.progress) && Array.isArray(v.answers) && object(v.retired));
    const seen = new Set();
    const groups = new Map();
    for (const q of value.questions) {
      if (!object(q) || seen.has(q.id) || builtinIds.has(q.id)) throw fail('追加問題の保存データに不正またはID衝突がある。自動削除は行わない');
      seen.add(q.id);
      if (!groups.has(q.subject)) groups.set(q.subject, []);
      groups.get(q.subject).push(q);
    }
    for (const [subject, questions] of groups) {
      const result = QuestionPacks.validate({ schemaVersion: 1, subject, questions });
      if (!result.ok) throw fail(`保存済み追加問題が不正: ${result.errors[0].path}: ${result.errors[0].reason}`);
    }
    for (const [id, entry] of Object.entries(value.retired)) {
      if (!object(entry) || typeof entry.signature !== 'string' || typeof entry.subject !== 'string' || builtinIds.has(id) || seen.has(id)) throw fail('保持履歴の照合情報が不正。自動初期化は行わない');
    }
    const allowed = new Set([...seen, ...Object.keys(value.retired)]);
    if (Object.keys(value.progress).some((id) => !allowed.has(id)) || value.answers.some((r) => !object(r) || !allowed.has(r.questionId))) throw fail('追加問題と履歴の対応が壊れている。自動初期化は行わない');
    return value;
  }

  // 普段の登録・回答・履歴保持削除はimportsの1キーのみ。
  // 旧保存キーも消す明示的な履歴削除は、対象3キーを退避して一括更新する。
  const TX_KEYS = [PROGRESS_KEY, ANSWERS_KEY, IMPORTS_KEY];
  function recover() {
    const store = backend();
    const raw = store.getItem(JOURNAL_KEY);
    if (raw === null) return;
    let journal;
    try { journal = JSON.parse(raw); } catch (e) { throw fail('未完了の保存記録が壊れている。既存データを保持して処理を停止', e); }
    if (!object(journal) || !object(journal.before)) throw fail('未完了の保存記録が不正。処理を停止');
    const keys = Object.keys(journal.before);
    const validV1 = journal.version === 1 && keys.length === 2 && [PROGRESS_KEY, ANSWERS_KEY].every(k => own(journal.before, k));
    const validV2 = journal.version === 2 && keys.length > 0 && keys.length <= 3 && keys.every(k => TX_KEYS.includes(k));
    if ((!validV1 && !validV2) || keys.some(k => journal.before[k] !== null && typeof journal.before[k] !== 'string')) throw fail('未完了の保存記録が不正。処理を停止');
    try {
      for (const key of keys) {
        // 失敗したsetItem等で既に旧値のままなら、不要な再書込みはしない。
        if (store.getItem(key) === journal.before[key]) continue;
        if (journal.before[key] === null) store.removeItem(key);
        else store.setItem(key, journal.before[key]);
      }
      store.removeItem(JOURNAL_KEY);
    } catch (e) { throw fail('未完了の保存を復元できない。復元記録を保持したので保存設定の確認後に再読み込みする', e); }
  }
  function writeTransaction(updates) {
    const store = backend();
    const keys = Object.keys(updates);
    if (!keys.length || keys.some(k => !TX_KEYS.includes(k))) throw fail('保存トランザクションの対象が不正');
    const before = Object.fromEntries(keys.map(k => [k, store.getItem(k)]));
    write(JOURNAL_KEY, { version: 2, before });
    try {
      keys.forEach(k => write(k, updates[k]));
      store.removeItem(JOURNAL_KEY);
    } catch (e) {
      try { recover(); } catch (recoveryError) { throw recoveryError; }
      throw e;
    }
  }
  function writeBuiltinAnswer(progress, answers) {
    writeTransaction({ [PROGRESS_KEY]: progress, [ANSWERS_KEY]: answers });
  }
  function run(fn) {
    const execute = () => { recover(); return fn(); };
    const task = async () => {
      if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.request !== 'function') return execute();
      let entered = false;
      try { return await navigator.locks.request('quiz-app.storage.v1', () => { entered = true; return execute(); }); }
      catch (e) {
        // file:等でロックAPIだけが利用できない場合。処理開始後のエラーは再実行しない。
        if (!entered && e.name === 'SecurityError') return execute();
        throw e;
      }
    };
    const result = chain.then(task);
    chain = result.catch(() => {});
    return result;
  }
  function legacyProgress() {
    return Object.fromEntries(Object.entries(read(PROGRESS_KEY, {}, object))
      .filter(([id]) => !RESTART_LEGACY_IDS.has(id)));
  }
  function legacyAnswers() {
    return read(ANSWERS_KEY, [], Array.isArray)
      .filter((record) => !RESTART_LEGACY_IDS.has(record.questionId));
  }
  function reservedIds() {
    const progress = read(PROGRESS_KEY, {}, object);
    const answers = read(ANSWERS_KEY, [], Array.isArray);
    return [...new Set([...Object.keys(progress), ...answers.map((r) => r.questionId)])];
  }
  function inspect(input, data) {
    // まず形式と登録・保持中の内容を検査。その後に旧保存キーのIDを照合する。
    const result = QuestionPacks.validate(input, builtIns.concat(data.questions), data.retired);
    if (result.ok) {
      const reserved = new Set(reservedIds());
      const reused = [];
      const restarted = [];
      const conflicts = [];
      result.pack.questions.forEach((q, i) => {
        if (!reserved.has(q.id)) return;
        const known = own(legacyIdentities, q.id) ? legacyIdentities[q.id] : null;
        const retiredSame = own(data.retired, q.id) && data.retired[q.id].signature === QuestionPacks.signature(q);
        const archiveSame = known && known.subject === q.subject && known.sha256 === QuestionPacks.fingerprint(q);
        if (!retiredSame && !archiveSame) conflicts.push({ path: `問題${i + 1} (${q.id}).id`, reason: '旧学習履歴が使用しているID。保存された照合情報または同梱の旧問題パックと内容が一致しないため、履歴の結合と登録を中止する' });
        else if (RESTART_LEGACY_IDS.has(q.id)) restarted.push(q.id);
        else reused.push(q.id);
      });
      if (conflicts.length) return { ok: false, errors: conflicts };
      result.reusedLegacyIds = reused;
      result.restartedLegacyIds = restarted;
      const merged = data.questions.filter((q) => q.subject === result.pack.subject).concat(result.pack.questions);
      const exported = QuestionPacks.exportSubject(merged, result.pack.subject);
      // 複数回追加しても「書き出したJSONを取り込めない」状態にはしない。
      if (new TextEncoder().encode(JSON.stringify(exported, null, 2) + '\n').length > QuestionPacks.MAX_BYTES) {
        return { ok: false, errors: [{ path: 'questions', reason: 'この科目の追加分は、書き出し時のJSONで2 MiBまで。今回の追加を含めると上限を超えるため、全体を登録しない' }] };
      }
    }
    return result;
  }
  function checkActive(data, id) {
    if (builtinIds.has(id)) return false;
    if (data.questions.some((q) => q.id === id)) return true;
    throw fail('この問題は別画面で削除された可能性がある。開始画面へ戻って再読み込みする');
  }

  return {
    async initialize(questions = [], identities = {}) {
      builtIns = clone(questions);
      builtinIds = new Set(questions.map((q) => q.id));
      legacyIdentities = clone(identities);
      return run(() => { imports(); return true; });
    },
    async getAllProgress() { return run(() => ({ ...legacyProgress(), ...imports().progress })); },
    async putProgress(id, progress) {
      return run(() => {
        const data = imports();
        if (checkActive(data, id)) { data.progress[id] = clone(progress); write(IMPORTS_KEY, data); }
        else { const all = read(PROGRESS_KEY, {}, object); write(PROGRESS_KEY, { ...all, [id]: progress }); }
      });
    },
    async appendAnswer(record) {
      return run(() => {
        const data = imports();
        if (checkActive(data, record.questionId)) { data.answers.push(clone(record)); write(IMPORTS_KEY, data); }
        else write(ANSWERS_KEY, read(ANSWERS_KEY, [], Array.isArray).concat(record));
      });
    },
    /** 回答履歴と進捗を一緒に確定する。更新関数は同期・副作用なしとする。 */
    async recordAnswer(id, record, updateProgress) {
      return run(() => {
        const data = imports();
        if (record.attemptId) {
          const saved = data.answers.concat(legacyAnswers()).find(r => r.questionId === id && r.attemptId === record.attemptId);
          if (saved) throw Object.assign(fail('この採点結果はすでに記録済みです。'), { code: 'ANSWER_ALREADY_RECORDED', record: clone(saved) });
        }
        if (checkActive(data, id)) {
          const legacy = legacyProgress();
          const previous = own(data.progress, id) ? data.progress[id] : legacy[id];
          data.progress[id] = updateProgress(previous);
          data.answers.push(clone(record));
          write(IMPORTS_KEY, data);
          return clone(data.progress[id]);
        }
        const progress = read(PROGRESS_KEY, {}, object);
        progress[id] = updateProgress(progress[id]);
        const answers = read(ANSWERS_KEY, [], Array.isArray).concat(record);
        writeBuiltinAnswer(progress, answers);
        return clone(progress[id]);
      });
    },
    async getAnswers() {
      return run(() => legacyAnswers().concat(imports().answers).sort((a, b) => String(a.answeredAt).localeCompare(String(b.answeredAt))));
    },
    async getSelectedSubjects() { return run(() => read(SELECTED_KEY, [], (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))); },
    async putSelectedSubjects(subjects) { return run(() => write(SELECTED_KEY, subjects)); },
    async getTutorialSeen() { return run(() => read(TUTORIAL_KEY, false, (v) => typeof v === 'boolean')); },
    async putTutorialSeen(seen) { return run(() => write(TUTORIAL_KEY, seen)); },
    async getImportedQuestions() { return run(() => imports().questions); },
    async validateImport(input) { return run(() => inspect(input, imports())); },
    async importPack(input) {
      return run(() => {
        const data = imports();
        const result = inspect(input, data); // プレビュー後に別タブで変わっても、ここで再検査する。
        if (!result.ok) { const e = fail('登録を中止した。検査結果を確認する'); e.validationErrors = result.errors; throw e; }
        data.questions.push(...result.pack.questions);
        result.pack.questions.forEach((q) => { delete data.retired[q.id]; });
        write(IMPORTS_KEY, data);
        return result;
      });
    },
    async exportSubject(subject) { return run(() => QuestionPacks.exportSubject(imports().questions, subject)); },
    async deleteImportedSubject(subject, deleteHistory, expectedIds) {
      return run(() => {
        const data = imports();
        const targets = data.questions.filter((q) => q.subject === subject);
        if (!targets.length) throw fail('削除できる登録問題は0問');
        const ids = targets.map((q) => q.id).sort();
        if (!Array.isArray(expectedIds) || JSON.stringify(ids) !== JSON.stringify([...expectedIds].sort())) throw fail('確認後に追加問題が変わった。削除対象をもう一度確認する');
        const removed = new Set(ids);
        data.questions = data.questions.filter((q) => !removed.has(q.id));
        targets.forEach((q) => {
          if (!deleteHistory) data.retired[q.id] = { subject, signature: QuestionPacks.signature(q) };
        });
        if (deleteHistory) {
          // この科目で以前保持した追加問題の履歴も対象。組込IDは入らない。
          Object.entries(data.retired).forEach(([id, entry]) => { if (entry.subject === subject) removed.add(id); });
          removed.forEach((id) => { delete data.progress[id]; delete data.retired[id]; });
          data.answers = data.answers.filter((r) => !removed.has(r.questionId));
        }
        if (deleteHistory) {
          // 利用者が「履歴も削除」を選んだ場合に限り、対象IDの旧履歴も消す。
          // 他科目・不明なIDは保持し、失敗時はimportsも含めて復元する。
          const legacyProgress = read(PROGRESS_KEY, {}, object);
          const legacyAnswers = read(ANSWERS_KEY, [], Array.isArray);
          const nextProgress = Object.fromEntries(Object.entries(legacyProgress).filter(([id]) => !removed.has(id)));
          const nextAnswers = legacyAnswers.filter(r => !removed.has(r.questionId));
          const updates = { [IMPORTS_KEY]: data };
          if (Object.keys(nextProgress).length !== Object.keys(legacyProgress).length) updates[PROGRESS_KEY] = nextProgress;
          if (nextAnswers.length !== legacyAnswers.length) updates[ANSWERS_KEY] = nextAnswers;
          if (Object.keys(updates).length > 1) writeTransaction(updates);
          else write(IMPORTS_KEY, data);
        } else write(IMPORTS_KEY, data);
        return targets.length;
      });
    },
    isStorageKey(key) { return key === null || KEYS.includes(key); },
  };
})();
