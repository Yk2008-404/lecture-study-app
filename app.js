/**
 * 学習アプリ v1 - 段階3
 * 段階2(履歴の保存と箱ロジック)に、重要度(A/B/C)の変更機能を追加。
 * 重要度は出題選定に反映される。間隔と順位の判断はscheduler.jsに従う。
 *
 * 出題選定と箱の更新は scheduler.js、保存は storage.js に分離している。
 */

const SESSION_SIZES = [10, 16, 24, 32, 40];
let availableQuestions = QUESTIONS.slice();
let currentScreen = 'start';
let quizBusy = false;
let subjectBusy = false;

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
  screens[name].setAttribute('tabindex', '-1');
  screens[name].focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function startSession(count) {
  if (quizBusy || subjectBusy) return;
  quizBusy = true;
  try {
    await refreshQuestions();
    const progressAll = await Storage.getAllProgress();
    state.questions = Scheduler.selectQuestions(
      availableQuestions.filter(QuestionPacks.supported), progressAll, count, new Date(), state.subjects
    );
    state.index = 0;
    state.results = [];
    state.answered = false;
    if (state.questions.length === 0) {
      notify(availableQuestions.length ? '現在出題できる問題がない。想起形式はまだ出題に対応していない。' : '科目を追加すると学習を始められる。');
      return;
    }
    await renderQuestion();
    showScreen('quiz');
  } finally { quizBusy = false; }
}

function renderSessionProgress() {
  const progress = document.getElementById('session-progress');
  if (!progress) return;
  progress.max = state.questions.length;
  progress.value = state.results.length;
}

async function renderQuestion() {
  const question = state.questions[state.index];
  state.answered = false;

  // 出題した時点で最終出題日時を更新する。
  // (解答時ではなく出題時に記録することで、途中で閉じても「出題済み」が残る)
  const progressAll = await Storage.getAllProgress();
  const progress = Scheduler.getProgress(progressAll, question);
  await Storage.putProgress(question.id, Scheduler.markAsked(progress, new Date()));

  document.getElementById('retry-action').hidden = true;
  document.getElementById('retry-action').onclick = null;
  renderImportance(progress.importance);

  document.getElementById('progress').textContent =
    `${state.index + 1} / ${state.questions.length} 問`;
  renderSessionProgress();
  document.getElementById('question-subject').textContent = question.subject;
  document.getElementById('question-text').textContent = question.text;

  const list = document.getElementById('choices');
  list.textContent = '';

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
  } finally { quizBusy = false; }
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
  } finally { quizBusy = false; }
}

async function goNext() {
  if (currentScreen !== 'quiz' || !state.answered || quizBusy) return;
  if (state.index < state.questions.length - 1) {
    quizBusy = true;
    state.index += 1;
    try { await renderQuestion(); }
    catch (e) { state.index -= 1; state.answered = true; throw e; }
    finally { quizBusy = false; }
  } else { renderResult(); }
}

/** 回答済みの結果を確認して終了する。未回答を誤答として保存しない。 */
async function finishSession() {
  if (currentScreen !== 'quiz' || quizBusy) return;
  if (state.results.length) renderResult();
  else {
    quizBusy = true;
    try { await renderStart(); } finally { quizBusy = false; }
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
  if (!result.isCorrect) {
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
    `回答 ${total} 問の履歴を保存しました。` +
    (total < state.questions.length ? `未回答 ${state.questions.length - total} 問は採点していません。` : '') +
    '次の学習では、復習時期を迎えた問題を優先します。';

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
      el.disabled = !questionsInScope().some(QuestionPacks.supported);
    });
  }
}

/** 選択中の科目で、何問が出題対象かを示す。 */
async function renderStartNote() {
  const progressAll = await Storage.getAllProgress();
  const now = new Date();
  const all = questionsInScope();
  const scope = all.filter(QuestionPacks.supported);
  const recall = all.length - scope.length;
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
    `出題可能 ${scope.length} 問 / 未出題 ${newCount} 問 / 復習時期 ${dueCount} 問` +
    (scope.length ? '。出題数を選ぶと開始します。復習を優先し、不足分は期限が近い問題で補います。' : '。科目を追加するか、出題可能な科目を選んでください。') +
    (recall ? ` 想起 ${recall} 問は保存のみで、出題には未対応です。` : '');
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
}

document.getElementById('next').addEventListener('click', safeAction(goNext));
document.getElementById('restart').addEventListener('click', safeAction(renderStart));
document.getElementById('result-back').addEventListener('click', safeAction(renderStart));
document.getElementById('finish-session').addEventListener('click', safeAction(finishSession));
document.getElementById('show-tutorial').addEventListener('click', openTutorial);
document.getElementById('tutorial-skip').addEventListener('click', safeAction(closeTutorial));
document.getElementById('tutorial-start').addEventListener('click', safeAction(closeTutorial));
document.getElementById('dismiss-notice').addEventListener('click', () => { document.getElementById('app-notice').hidden = true; });
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
