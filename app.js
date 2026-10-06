/**
 * 学習アプリ v1 - 段階3
 * 段階2(履歴の保存と箱ロジック)に、重要度(A/B/C)の変更機能を追加。
 * 重要度は出題選定に反映される。間隔と順位の判断はscheduler.jsに従う。
 *
 * 出題選定と箱の更新は scheduler.js、保存は storage.js に分離している。
 */

const SESSION_SIZES = [10, 16, 24, 32, 40];
const desktopBridge = window.studyDesktop || null;
const AI_PROVIDER_KEY = 'study-app.ai-provider.v1';
let desktopProvider = 'codex';
let desktopStatus = { providers: [], busy: false };
let desktopOperation = null;
let desktopRun = 0;
let desktopInitialized = false;
let desktopLog = [];
let availableQuestions = QUESTIONS.slice();
let currentScreen = 'start';
let quizBusy = false;
let subjectBusy = false;

function canAskQuestion(question) {
  return QuestionPacks.supported(question) && (question.questionType !== '記述' || !!desktopBridge);
}

function selectedProviderStatus() {
  return desktopStatus.providers.find(provider => provider.id === desktopProvider);
}
function providerName() { return desktopProvider === 'claude' ? 'Claude' : 'Codex'; }
function desktopMessage(message) {
  const status = document.getElementById('desktop-ai-status');
  if (status) status.textContent = String(message || '').slice(0, 500);
}
function updateDesktopControls() {
  const panel = document.getElementById('desktop-ai-panel');
  const written = state.questions[state.index]?.questionType === '記述';
  if (panel) panel.hidden = !desktopBridge || !(currentScreen === 'start' || (currentScreen === 'quiz' && written));
  if (!desktopBridge) return;
  const provider = selectedProviderStatus();
  const operating = !!desktopOperation || desktopStatus.busy;
  const scoring = ['grade', 'saving', 'cancel'].includes(desktopOperation);
  const select = document.getElementById('desktop-ai-provider');
  if (select) { select.value = desktopProvider; select.disabled = operating; }
  const install = document.getElementById('desktop-ai-install');
  const login = document.getElementById('desktop-ai-login');
  const refresh = document.getElementById('desktop-ai-refresh');
  const cancel = document.getElementById('desktop-ai-cancel');
  if (install) { install.hidden = !!provider?.installed; install.disabled = operating || !provider; }
  if (login) { login.hidden = !provider?.installed || !!provider?.loggedIn; login.disabled = operating; }
  if (refresh) refresh.disabled = !!desktopOperation;
  if (cancel) { cancel.hidden = !operating || desktopOperation === 'saving'; cancel.disabled = desktopOperation === 'cancel'; }
  const grade = document.getElementById('grade-written');
  const savedResult = !!document.getElementById('written-grade')?.value.trim();
  if (grade) {
    grade.hidden = state.answered;
    grade.disabled = operating || quizBusy || state.answered || (!savedResult && !(provider?.installed && provider?.loggedIn));
    grade.textContent = savedResult ? '採点結果を保存' : 'AIで採点';
  }
  const response = document.getElementById('written-response');
  if (response && written) response.readOnly = state.answered || scoring;
  const finish = document.getElementById('finish-session');
  if (finish) finish.disabled = scoring;
}
function describeDesktopStatus() {
  const provider = selectedProviderStatus();
  if (!provider) { desktopMessage('状態を確認してください。'); return; }
  const summary = !provider.installed ? 'インストールしてください。' : !provider.loggedIn ? 'ログインしてください。' : '準備完了';
  desktopMessage(`${providerName()}：${summary}`);
}
async function refreshDesktopStatus() {
  if (!desktopBridge) return;
  const status = await desktopBridge.getStatus();
  desktopStatus = {
    providers: Array.isArray(status?.providers) ? status.providers.filter(provider => ['codex', 'claude'].includes(provider.id)) : [],
    busy: !!status?.busy,
  };
  describeDesktopStatus();
  updateDesktopControls();
}
async function initializeDesktopAI() {
  if (!desktopBridge || desktopInitialized) return;
  desktopInitialized = true;
  try {
    const saved = window.localStorage.getItem(AI_PROVIDER_KEY);
    if (saved === 'codex' || saved === 'claude') desktopProvider = saved;
  } catch (_) { /* Provider selection remains usable without preference storage. */ }
  const location = document.getElementById('storage-location');
  if (location) location.textContent = '問題・履歴はこのPCに保存されます。';
  const browserNote = document.getElementById('browser-format-note');
  if (browserNote) browserNote.hidden = true;
  if (typeof desktopBridge.onProgress === 'function') desktopBridge.onProgress(event => {
    if (event?.provider && event.provider !== desktopProvider) return;
    const message = String(event?.message || '').slice(0, 4000);
    if (!message) return;
    desktopLog.push(message);
    desktopLog = desktopLog.slice(-12);
    const log = document.getElementById('desktop-ai-log');
    if (log) log.textContent = desktopLog.join('\n').slice(-4000);
    if (desktopOperation) desktopMessage(message);
  });
  desktopMessage('状態を確認中…');
  updateDesktopControls();
  try { await refreshDesktopStatus(); }
  catch (error) { desktopMessage(error.message || '状態を確認できません。'); }
}
function changeDesktopProvider() {
  if (!desktopBridge || desktopOperation || desktopStatus.busy) { updateDesktopControls(); return; }
  const value = document.getElementById('desktop-ai-provider').value;
  if (!['codex', 'claude'].includes(value)) return;
  desktopProvider = value;
  try { window.localStorage.setItem(AI_PROVIDER_KEY, value); } catch (_) { /* Keep the page selection. */ }
  desktopLog = [];
  const log = document.getElementById('desktop-ai-log');
  if (log) log.textContent = '';
  describeDesktopStatus(); updateDesktopControls();
}
async function setupDesktopProvider(action) {
  if (!desktopBridge || desktopOperation || desktopStatus.busy) return;
  const run = ++desktopRun;
  desktopOperation = action;
  updateDesktopControls();
  desktopMessage(action === 'install' ? 'インストール中…' : 'ログインを開いています…');
  try {
    const result = await desktopBridge[action](desktopProvider);
    if (run !== desktopRun) return;
    if (action === 'install' && Array.isArray(result?.providers)) desktopStatus = result;
    else await refreshDesktopStatus();
    if (action === 'login' && result?.started) desktopMessage('ログイン後に「状態を更新」を押してください。');
    else describeDesktopStatus();
  } catch (error) {
    if (run === desktopRun) desktopMessage(error.message || '処理できませんでした。');
  } finally {
    if (run === desktopRun) { desktopOperation = null; updateDesktopControls(); }
  }
}
async function cancelDesktopOperation() {
  if (!desktopBridge || desktopOperation === 'cancel' || desktopOperation === 'saving' || (!desktopOperation && !desktopStatus.busy)) return;
  const wasGrading = desktopOperation === 'grade';
  const run = ++desktopRun;
  let cancelled = false;
  desktopOperation = 'cancel'; updateDesktopControls();
  try { await desktopBridge.cancel(); cancelled = true; desktopMessage('取り消しました。'); }
  catch (error) { desktopMessage(error.message || '取り消せませんでした。'); }
  finally {
    if (run === desktopRun) {
      desktopOperation = null;
      desktopStatus.busy = !cancelled;
      if (wasGrading) quizBusy = false;
      updateDesktopControls();
    }
  }
}

function notify(message, isError = false, retry = null) {
  const box = document.getElementById('app-notice');
  box.hidden = false;
  box.className = 'notice' + (isError ? ' is-error' : '');
  document.getElementById('notice-text').textContent = message;
  const button = document.getElementById('retry-action');
  button.hidden = !retry;
  button.onclick = retry ? safeAction(retry) : null;
}
function safeAction(action) {
  return async (...args) => {
    try { return await action(...args); }
    catch (e) { notify(e.message || String(e), true, () => action(...args)); }
  };
}
async function refreshQuestions() {
  availableQuestions = QUESTIONS.concat(await Storage.getImportedQuestions());
}


/**
 * 重要度の内部値と表示ラベルの対応。
 * value は保存データと出題ロジックで使う固定値。変更すると既存の履歴が読めなくなる。
 * label は表示専用で、変更してもデータには影響しない。
 */
const IMPORTANCE_LEVELS = [
  { value: 'A', label: '重点' },
  { value: 'B', label: '標準' },
  { value: 'C', label: '後回し' },
];

const state = {
  /** 選択中の科目。空配列は「全科目」を意味する */
  subjects: [],
  /** 今回のセッションで出題する問題の配列 */
  questions: [],
  /** 現在の問題の位置 (0始まり) */
  index: 0,
  /** 解答結果の記録: { question, selected, isCorrect } */
  results: [],
  /** 現在の問題に解答済みかどうか (解答後は選択肢を固定し、正誤を表示する) */
  answered: false,
};

const screens = {
  tutorial: document.getElementById('screen-tutorial'),
  start: document.getElementById('screen-start'),
  quiz: document.getElementById('screen-quiz'),
  result: document.getElementById('screen-result'),
  manager: document.getElementById('screen-manager'),
  'pack-help': document.getElementById('screen-pack-help'),
};

function showScreen(name) {
  currentScreen = name;
  document.getElementById('retry-action').hidden = true;
  document.getElementById('retry-action').onclick = null;
  Object.keys(screens).forEach((key) => {
    screens[key].hidden = key !== name;
  });
  document.getElementById('show-tutorial').hidden = name !== 'start';
  screens[name].setAttribute('tabindex', '-1');
  screens[name].focus({ preventScroll: true });
  window.scrollTo(0, 0);
  updateDesktopControls();
}

async function startSession(count) {
  if (quizBusy || subjectBusy) return;
  quizBusy = true;
  try {
    await refreshQuestions();
    const progressAll = await Storage.getAllProgress();
    state.questions = Scheduler.selectQuestions(
      availableQuestions.filter(canAskQuestion), progressAll, count, new Date(), state.subjects
    );
    state.index = 0;
    state.results = [];
    state.answered = false;
    if (state.questions.length === 0) {
      notify(availableQuestions.length ? '出題できる問題がありません。記述はPC専用アプリで使えます。' : '科目を追加すると学習を始められます。');
      return;
    }
    await renderQuestion();
    showScreen('quiz');
  } finally { quizBusy = false; updateDesktopControls(); }
}

function renderSessionProgress() {
  const progress = document.getElementById('session-progress');
  if (!progress) return;
  progress.max = state.questions.length;
  progress.value = state.results.length;
}

async function renderQuestion() {
  const question = state.questions[state.index];
  if (!canAskQuestion(question)) throw new Error('この問題はここでは出題できません。記述はPC専用アプリで使えます。');
  state.answered = false;

  // 出題した時点で最終出題日時を更新する。
  // (解答時ではなく出題時に記録することで、途中で閉じても「出題済み」が残る)
  const progressAll = await Storage.getAllProgress();
  const progress = Scheduler.getProgress(progressAll, question);
  await Storage.putProgress(question.id, Scheduler.markAsked(progress, new Date()));
  const writtenDraft = question.questionType === '記述' ? await loadWrittenDraft(question) : null;

  document.getElementById('retry-action').hidden = true;
  document.getElementById('retry-action').onclick = null;
  renderImportance(progress.importance);

  document.getElementById('progress').textContent =
    `${state.index + 1} / ${state.questions.length} 問`;
  renderSessionProgress();
  document.getElementById('question-subject').textContent = question.subject;
  document.getElementById('question-text').textContent = question.text;
  document.getElementById('quiz-note').textContent = question.questionType === '記述'
    ? '下書き・記録はこの端末に保存されます。'
    : '回答は自動保存。解説は終了後に表示します。';

  const list = document.getElementById('choices');
  list.textContent = '';
  list.hidden = question.questionType === '記述';
  renderWritten(question, writtenDraft);

  question.choices.forEach((choice, i) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = choice;
    button.addEventListener('click', safeAction(() => answer(i)));
    li.appendChild(button);
    list.appendChild(li);
  });

  const feedback = document.getElementById('feedback');
  feedback.textContent = '';
  feedback.className = 'feedback';
  document.getElementById('next').hidden = true;
  document.getElementById('question-text').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function answer(selected) {
  if (currentScreen !== 'quiz' || state.answered || quizBusy) return;
  if (state.questions[state.index].questionType === '記述') return;
  quizBusy = true;
  const question = state.questions[state.index];
  const isCorrect = selected === question.answer;
  const now = new Date();
  try {
    await Storage.recordAnswer(question.id, {
      questionId: question.id, isCorrect, answeredAt: now.toISOString(),
    }, (stored) => {
      const progress = Scheduler.getProgress(stored ? { [question.id]: stored } : {}, question);
      return Scheduler.applyAnswer(progress, isCorrect, question.questionType);
    });
    // 保存成功後にだけ回答済みとする。再試行で同じ回答を二重追加しない。
    document.getElementById('app-notice').hidden = true;
    document.getElementById('retry-action').hidden = true;
    document.getElementById('retry-action').onclick = null;
    state.answered = true;
    state.results.push({ question, selected, isCorrect });
    renderSessionProgress();
    document.querySelectorAll('#choices .choice').forEach((button, i) => {
      button.disabled = true;
      if (i === question.answer) button.classList.add('is-answer');
      else if (i === selected) button.classList.add('is-wrong');
    });
    const feedback = document.getElementById('feedback');
    feedback.textContent = isCorrect ? '正解' : `不正解：正解は「${question.choices[question.answer]}」`;
    feedback.className = `feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
    const next = document.getElementById('next');
    next.hidden = false;
    next.textContent = state.index === state.questions.length - 1 ? '結果を見る' : '次の問題へ';
    next.focus();
  } finally { quizBusy = false; updateDesktopControls(); }
}

async function loadWrittenDraft(question) {
  let draft = WrittenPractice.draft(question);
  if (draft.attemptId && (await Storage.getAnswers()).some(r => r.questionId === question.id && r.attemptId === draft.attemptId)) {
    WrittenPractice.discard(question, draft);
    draft = WrittenPractice.draft(question);
  }
  return draft;
}

function renderWritten(question, draft) {
  const panel = document.getElementById('written-tools');
  panel.hidden = !desktopBridge || question.questionType !== '記述';
  if (panel.hidden) return;
  const response = document.getElementById('written-response');
  response.value = draft.response;
  response.readOnly = false;
  document.getElementById('written-grade').value = draft.resultText;
  document.getElementById('written-grade-panel').open = !!draft.resultText;
  document.getElementById('written-transfer').hidden = true;
  document.getElementById('written-prompt-panel').hidden = true;
  document.getElementById('written-prompt').value = '';
  document.getElementById('written-evaluation').hidden = true;
  document.getElementById('written-status').textContent = draft.response ? '下書きを復元しました。' : '';
  updateDesktopControls();
}

function activeWritten() {
  if (!desktopBridge || currentScreen !== 'quiz' || state.answered || quizBusy) return null;
  const question = state.questions[state.index];
  return question?.questionType === '記述' ? question : null;
}

function saveWrittenDraft() {
  const question = activeWritten();
  if (!question) return;
  const response = document.getElementById('written-response').value;
  const resultInput = document.getElementById('written-grade');
  const saved = WrittenPractice.update(question, response, resultInput.value);
  resultInput.value = saved.resultText;
  document.getElementById('written-prompt-panel').hidden = true;
  document.getElementById('written-status').textContent = '下書きを保存しました。';
  updateDesktopControls();
}

async function gradeWritten() {
  const question = activeWritten();
  if (!question || desktopOperation || desktopStatus.busy) return;
  const response = document.getElementById('written-response').value;
  let draft = WrittenPractice.prepare(question, response);
  let raw = document.getElementById('written-grade').value || draft.resultText;
  let grade = null;
  if (raw) {
    try { grade = WrittenPractice.parseResult(raw, question, draft); }
    catch (_) { raw = ''; }
  }
  const provider = selectedProviderStatus();
  if (!grade && !(provider?.installed && provider?.loggedIn)) throw new Error(`${providerName()}のインストールとログインを確認してください。`);
  const run = ++desktopRun;
  desktopOperation = 'grade'; quizBusy = true;
  updateDesktopControls();
  document.getElementById('written-status').textContent = grade ? '採点結果を保存中…' : 'AIで採点中…';
  try {
    if (!grade) {
      const result = await desktopBridge.grade({ provider: desktopProvider, question, response, attemptId: draft.attemptId });
      if (run !== desktopRun) return;
      if (currentScreen !== 'quiz' || state.questions[state.index] !== question || state.answered) return;
      raw = JSON.stringify(result);
      grade = WrittenPractice.parseResult(raw, question, draft);
      document.getElementById('written-grade').value = raw;
    }
    draft = WrittenPractice.update(question, response, raw);
    desktopOperation = 'saving'; updateDesktopControls();
    await commitWrittenGrade(question, response, draft, grade);
    desktopMessage('採点が終わりました。');
  } catch (error) {
    if (run !== desktopRun) return;
    document.getElementById('written-status').textContent = '採点を完了できませんでした。解答は残っています。';
    desktopMessage(error.message || '採点できませんでした。');
    throw error;
  } finally {
    if (run === desktopRun) {
      desktopOperation = null; desktopStatus.busy = false; quizBusy = false;
      updateDesktopControls();
    }
  }
}

async function copyWritten() {
  const question = activeWritten();
  if (!question) return;
  const response = document.getElementById('written-response').value;
  const draft = WrittenPractice.prepare(question, response);
  const text = WrittenPractice.prompt(question, draft);
  const input = document.getElementById('written-prompt');
  input.value = text;
  const panel = document.getElementById('written-prompt-panel');
  panel.hidden = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    document.getElementById('written-status').textContent = 'コピーしました。使うAIに貼り付けてください。';
  } catch (_) {
    panel.open = true;
    input.focus(); input.select();
    document.getElementById('written-status').textContent = '下の指示文を選択してコピーしてください。';
  }
}

function appendWrittenEvaluation(container, question, response, grade, includeResponse = true) {
  for (const [label, content] of [
    ['AI評価', `${grade.score} / 100`], ['あなたの解答', response],
    ['評価・不足点', grade.feedback], ['改善例', grade.improvedAnswer], ['模範解答', question.answer],
  ].filter(([label]) => includeResponse || label !== 'あなたの解答')) {
    const block = document.createElement('div');
    block.className = 'written-detail';
    const title = document.createElement('strong'); title.textContent = label;
    const body = document.createElement('p'); body.className = 'written-copy'; body.textContent = content;
    block.append(title, body); container.appendChild(block);
  }
}

async function applyWrittenGrade() {
  const question = activeWritten();
  if (!question) return;
  const response = document.getElementById('written-response').value;
  const raw = document.getElementById('written-grade').value;
  const draft = WrittenPractice.update(question, response, raw);
  const grade = WrittenPractice.parseResult(raw, question, draft);
  quizBusy = true;
  try { await commitWrittenGrade(question, response, draft, grade); }
  finally { quizBusy = false; updateDesktopControls(); }
}

async function commitWrittenGrade(question, response, draft, grade) {
    let isCorrect = grade.score >= 80;
    try { await Storage.recordAnswer(question.id, {
      questionId: question.id, isCorrect, answeredAt: new Date().toISOString(),
      response, grading: grade, attemptId: draft.attemptId,
    }, stored => {
      const progress = Scheduler.getProgress(stored ? { [question.id]: stored } : {}, question);
      return Scheduler.applyAnswer(progress, isCorrect, question.questionType);
    }); } catch (error) {
      if (error.code !== 'ANSWER_ALREADY_RECORDED') throw error;
      response = error.record.response; grade = error.record.grading; isCorrect = error.record.isCorrect;
    }
    // Mark success before optional draft cleanup, so a cleanup error cannot duplicate the answer.
    state.answered = true;
    state.results.push({ question, selected: response, isCorrect, grading: grade });
    document.getElementById('app-notice').hidden = true;
    document.getElementById('retry-action').hidden = true;
    document.getElementById('retry-action').onclick = null;
    renderSessionProgress();
    document.getElementById('written-response').readOnly = true;
    document.getElementById('written-response').value = response;
    document.getElementById('written-transfer').hidden = true;
    document.getElementById('written-status').textContent = '採点結果を保存しました。';
    const evaluation = document.getElementById('written-evaluation');
    evaluation.textContent = '';
    appendWrittenEvaluation(evaluation, question, response, grade, false);
    evaluation.hidden = false;
    evaluation.setAttribute('tabindex', '-1');
    evaluation.focus();
    evaluation.scrollIntoView({ block: 'start' });
    const feedback = document.getElementById('feedback');
    feedback.textContent = isCorrect ? '正解として記録' : '要復習として記録';
    feedback.className = `feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
    const next = document.getElementById('next');
    next.hidden = false;
    next.textContent = state.index === state.questions.length - 1 ? '結果を見る' : '次の問題へ';
    try { WrittenPractice.discard(question, draft); }
    catch (_) { notify('採点結果は保存済みです。下書きの削除だけ失敗しました。', true); }
}

async function resumeWritten() {
  if (!desktopBridge || quizBusy || subjectBusy) return;
  quizBusy = true;
  try {
    await refreshQuestions();
    const pending = WrittenPractice.pending(availableQuestions, await Storage.getAnswers());
    if (!pending.length) { await renderStart(); return; }
    state.questions = pending;
    state.index = 0; state.results = []; state.answered = false;
    await renderQuestion(); showScreen('quiz');
  } finally { quizBusy = false; updateDesktopControls(); }
}

/** 現在の問題の重要度ボタンを描画する。 */
function renderImportance(selected) {
  const container = document.getElementById('importance');
  container.textContent = '';

  IMPORTANCE_LEVELS.forEach((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'importance-button';
    if (level.value === selected) {
      button.classList.add('is-selected');
    }
    button.textContent = level.label;
    button.setAttribute('aria-pressed', String(level.value === selected));
    button.addEventListener('click', safeAction(() => changeImportance(level.value)));
    container.appendChild(button);
  });
}

/** 現在の問題の重要度を変更して保存する。解答の前後どちらでも変更できる。 */
async function changeImportance(level) {
  if (currentScreen !== 'quiz' || quizBusy) return;
  quizBusy = true;
  try {
    const question = state.questions[state.index];
    const progressAll = await Storage.getAllProgress();
    const progress = Scheduler.getProgress(progressAll, question);
    await Storage.putProgress(question.id, Scheduler.setImportance(progress, level));
    renderImportance(level);
    document.getElementById('app-notice').hidden = true;
    document.getElementById('retry-action').hidden = true;
    document.getElementById('retry-action').onclick = null;
  } finally { quizBusy = false; updateDesktopControls(); }
}

async function goNext() {
  if (currentScreen !== 'quiz' || !state.answered || quizBusy) return;
  if (state.index < state.questions.length - 1) {
    quizBusy = true;
    state.index += 1;
    try { await renderQuestion(); }
    catch (e) { state.index -= 1; state.answered = true; throw e; }
    finally { quizBusy = false; updateDesktopControls(); }
  } else { renderResult(); }
}

/** 回答済みの結果を確認して終了する。未回答を誤答として保存しない。 */
async function finishSession() {
  if (currentScreen !== 'quiz' || quizBusy) return;
  if (state.results.length) renderResult();
  else {
    quizBusy = true;
    try { await renderStart(); } finally { quizBusy = false; updateDesktopControls(); }
  }
}

/**
 * 結果一覧の1件を描画する。
 * 解説は未設定の問題があるため、あるときだけ表示する。
 */
function appendResultItem(list, result) {
  const li = document.createElement('li');

  const text = document.createElement('p');
  text.className = 'result-question';
  text.textContent = result.question.text;
  li.appendChild(text);

  // 正解した問題は「あなたの解答 / 正解」が同じ内容になるため出さない。
  if (result.question.questionType === '記述') {
    appendWrittenEvaluation(li, result.question, result.selected, result.grading);
  } else if (!result.isCorrect) {
    const detail = document.createElement('p');
    detail.className = 'result-detail';
    detail.textContent =
      `あなたの解答: ${result.question.choices[result.selected]}` +
      ` / 正解: ${result.question.choices[result.question.answer]}`;
    li.appendChild(detail);
  }

  if (result.question.explanation) {
    const explanation = document.createElement('p');
    explanation.className = 'result-explanation';
    explanation.textContent = result.question.explanation;
    li.appendChild(explanation);
  }

  if (result.question.source) {
    const source = document.createElement('p');
    source.className = 'result-source';
    source.textContent = `出典：${result.question.source.document} / ${result.question.source.location}`;
    li.appendChild(source);
  }
  list.appendChild(li);
}

/** 誤答を先に、続けて正解を表示する。解説は結果画面でのみ出す。 */
function renderResult() {
  const wrong = state.results.filter((r) => !r.isCorrect);
  const correct = state.results.filter((r) => r.isCorrect);
  const total = state.results.length;

  document.getElementById('score').textContent =
    `${total} 問中 ${correct.length} 問正解`;
  document.getElementById('result-note').textContent =
    `${total} 問の回答を保存しました。` +
    (total < state.questions.length ? `未回答 ${state.questions.length - total} 問は採点していません。` : '');

  const wrongHeading = document.getElementById('wrong-heading');
  const wrongList = document.getElementById('wrong-list');
  wrongList.textContent = '';
  wrongHeading.textContent = wrong.length === 0 ? '誤答なし' : `誤答 ${wrong.length} 問`;
  wrong.forEach((result) => appendResultItem(wrongList, result));

  const correctHeading = document.getElementById('correct-heading');
  const correctList = document.getElementById('correct-list');
  correctList.textContent = '';
  correctHeading.hidden = correct.length === 0;
  correctHeading.textContent = `正解 ${correct.length} 問`;
  correct.forEach((result) => appendResultItem(correctList, result));

  showScreen('result');
}

/** 問題データに含まれる科目を、最初に現れた順で返す。 */
function listSubjects() {
  return [...new Set(availableQuestions.map((question) => question.subject))];
}

/** 選択中の科目に含まれる問題。未選択なら全科目。 */
function questionsInScope() {
  if (state.subjects.length === 0) {
    return availableQuestions;
  }
  return availableQuestions.filter((question) => state.subjects.includes(question.subject));
}

function renderSubjects() {
  const container = document.getElementById('subjects');
  container.textContent = '';

  listSubjects().forEach((subject) => {
    const label = document.createElement('label');
    label.className = 'subject';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = subject;
    checkbox.checked = state.subjects.includes(subject);
    checkbox.addEventListener('change', safeAction(() => toggleSubject(subject, checkbox.checked)));

    if (checkbox.checked) {
      label.classList.add('is-selected');
    }

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(subject));
    container.appendChild(label);
  });
}

/** 科目の選択を切り替えて保存する。 */
async function toggleSubject(subject, checked) {
  if (subjectBusy || quizBusy) { renderSubjects(); return; }
  subjectBusy = true;
  const nextSubjects = checked
    ? listSubjects().filter(
        (item) => item === subject || state.subjects.includes(item)
      )
    : state.subjects.filter((item) => item !== subject);

  document.querySelectorAll('#subjects input, #sizes button').forEach((el) => { el.disabled = true; });
  try {
    // 保存できた選択だけを出題に使う。失敗時は元の選択を表示する。
    await Storage.putSelectedSubjects(nextSubjects);
    state.subjects = nextSubjects;
    document.getElementById('app-notice').hidden = true;
    document.getElementById('retry-action').hidden = true;
    document.getElementById('retry-action').onclick = null;
    await renderStartNote();
  } finally {
    subjectBusy = false;
    renderSubjects();
    document.querySelectorAll('#sizes button').forEach((el) => {
      el.disabled = !questionsInScope().some(canAskQuestion);
    });
  }
}

/** 選択中の科目で、何問が出題対象かを示す。 */
async function renderStartNote() {
  const progressAll = await Storage.getAllProgress();
  const now = new Date();
  const all = questionsInScope();
  const scope = all.filter(canAskQuestion);
  const recall = all.filter(q => !QuestionPacks.supported(q)).length;
  const desktopOnly = desktopBridge ? 0 : all.filter(q => q.questionType === '記述').length;
  const progress = scope.map((question) => Scheduler.getProgress(progressAll, question));
  const newCount = progress.filter((p) => !p.lastAskedAt).length;
  const dueCount = progress.filter((p) => p.lastAskedAt && Scheduler.isDue(p, now)).length;

  const stats = {
    'stat-subjects': new Set(all.map((question) => question.subject)).size,
    'stat-questions': scope.length,
    'stat-review': dueCount,
  };
  Object.entries(stats).forEach(([id, count]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(count);
  });

  document.getElementById('start-note').textContent =
    (scope.length ? `未出題 ${newCount} 問` : '出題できる問題がありません。') +
    (desktopOnly ? ` 記述 ${desktopOnly} 問はPC専用アプリで出題できます。` : '') +
    (recall ? ` 想起 ${recall} 問は保存のみ（出題未対応）。` : '');
  const list = document.getElementById('sizes');
  list.textContent = '';
  const sizes = scope.length ? [...new Set(SESSION_SIZES.map((n) => Math.min(n, scope.length)))] : SESSION_SIZES;
  sizes.forEach((size) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'size';
    button.textContent = `${size} 問`;
    button.disabled = !scope.length || subjectBusy;
    button.addEventListener('click', safeAction(() => startSession(size)));
    list.appendChild(button);
  });
}

async function renderStart() {
  await refreshQuestions();
  // 保存済みの選択を復元する。問題データから消えた科目は落とす。
  const available = listSubjects();
  const saved = await Storage.getSelectedSubjects();
  state.subjects = saved.filter((subject) => available.includes(subject));

  const empty = available.length === 0;
  document.getElementById('empty-subjects').hidden = !empty;
  document.getElementById('subject-selection-hint').hidden = empty;
  renderSubjects();
  await renderStartNote();

  const resume = document.getElementById('resume-written');
  resume.hidden = true;
  if (desktopBridge && typeof WrittenPractice !== 'undefined') {
    const pending = WrittenPractice.pending(availableQuestions, await Storage.getAnswers());
    resume.hidden = pending.length === 0;
    resume.textContent = `記述の続き ${pending.length} 問`;
  }

  showScreen('start');
}

/** チュートリアルを表示する。開始画面からいつでも呼べる。 */
function openTutorial() {
  window.scrollTo(0, 0);
  showScreen('tutorial');
}

/** チュートリアルを閉じる。以降は初回起動時に表示しない。 */
async function closeTutorial() {
  await Storage.putTutorialSeen(true);
  await renderStart();
}

/** 起動時は学習開始画面へ。使い方は本人が必要なときに開く。 */
async function boot() {
  await Storage.initialize(QUESTIONS, LegacyQuestionIdentities);
  await renderStart();
  await initializeDesktopAI();
}

document.getElementById('next').addEventListener('click', safeAction(goNext));
document.getElementById('restart').addEventListener('click', safeAction(renderStart));
document.getElementById('result-back').addEventListener('click', safeAction(renderStart));
document.getElementById('finish-session').addEventListener('click', safeAction(finishSession));
document.getElementById('show-tutorial').addEventListener('click', openTutorial);
document.getElementById('tutorial-skip').addEventListener('click', safeAction(closeTutorial));
document.getElementById('tutorial-start').addEventListener('click', safeAction(closeTutorial));
document.getElementById('dismiss-notice').addEventListener('click', () => { document.getElementById('app-notice').hidden = true; });
document.getElementById('written-response').addEventListener('input', safeAction(saveWrittenDraft));
document.getElementById('written-grade').addEventListener('input', safeAction(saveWrittenDraft));
document.getElementById('copy-written').addEventListener('click', safeAction(copyWritten));
document.getElementById('apply-written').addEventListener('click', safeAction(applyWrittenGrade));
document.getElementById('resume-written').addEventListener('click', safeAction(resumeWritten));
document.getElementById('grade-written')?.addEventListener('click', safeAction(gradeWritten));
document.getElementById('desktop-ai-provider')?.addEventListener('change', changeDesktopProvider);
document.getElementById('desktop-ai-refresh')?.addEventListener('click', safeAction(refreshDesktopStatus));
document.getElementById('desktop-ai-install')?.addEventListener('click', () => setupDesktopProvider('install'));
document.getElementById('desktop-ai-login')?.addEventListener('click', () => setupDesktopProvider('login'));
document.getElementById('desktop-ai-cancel')?.addEventListener('click', cancelDesktopOperation);
SubjectManager.initialize({ showScreen, renderStart, refreshQuestions, notify, safeAction, builtIns: QUESTIONS });
window.addEventListener('storage', safeAction(async (event) => {
  if (!Storage.isStorageKey(event.key)) return;
  if (currentScreen === 'quiz') {
    notify('別の画面でデータが変更されたため、開始画面へ戻った。保存済みの履歴は保持している。');
    await renderStart();
  } else if (currentScreen === 'start') await renderStart();
  else if (currentScreen === 'manager') await SubjectManager.refresh();
}));
safeAction(boot)();
