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
let updateOffer = null;
const AI_MODE_KEY = 'study-app.ai-mode.v1';
let aiMode = true;
let generationSource = null;
let updateApplying = false;
let availableQuestions = QUESTIONS.slice();
let currentScreen = 'start';
let quizBusy = false;
let subjectBusy = false;

function canAskQuestion(question) {
  return QuestionPacks.supported(question) && (question.questionType !== '記述' || !!desktopBridge);
}

// 出題する形式（すべて／選択問題だけ／正誤だけ／記述だけ）。この端末に記憶する。
const QUESTION_MODES = { all: null, choice: '選択肢', truefalse: '正誤', written: '記述' };
const QUESTION_MODE_KEY = 'quiz-app.question-mode.v1';
let questionMode = 'all';
try { const saved = window.localStorage.getItem(QUESTION_MODE_KEY); if (Object.hasOwn(QUESTION_MODES, saved)) questionMode = saved; } catch (_) { /* 記憶できなくても「すべて」で使える */ }
const inQuestionMode = (question) => !QUESTION_MODES[questionMode] || question.questionType === QUESTION_MODES[questionMode];
/** 今の形式の設定で出題できる問題か。 */
const askable = (question) => canAskQuestion(question) && inQuestionMode(question);
async function changeQuestionMode(event) {
  if (!Object.hasOwn(QUESTION_MODES, event.target.value)) return;
  questionMode = event.target.value;
  try { window.localStorage.setItem(QUESTION_MODE_KEY, questionMode); } catch (_) { /* この画面の間だけ有効 */ }
  await renderStartNote();
}

/** ダブルチェックは、CodexとClaudeの両方を使える状態のときだけ「準備完了」になる。 */
const isLimited = (provider) => (provider?.limitedUntil || 0) > Date.now();
function selectedProviderStatus() {
  if (desktopProvider !== 'double') {
    const provider = desktopStatus.providers.find(p => p.id === desktopProvider);
    return provider && { ...provider, limited: isLimited(provider) };
  }
  const both = ['codex', 'claude'].map(id => desktopStatus.providers.find(provider => provider.id === id));
  if (both.some(provider => !provider)) return undefined;
  // ダブルチェックは、片方が上限でももう片方で続けられる。両方が上限のときだけ使えない。
  return { id: 'double', installed: both.every(p => p.installed), loggedIn: both.every(p => p.installed && p.loggedIn), limited: both.every(isLimited) };
}
function doubleReady() {
  return ['codex', 'claude'].every(id => desktopStatus.providers.some(p => p.id === id && p.installed && p.loggedIn));
}
/** AIを今すぐ使えるか（インストール・ログイン済みで、利用上限に達していない）。 */
function aiReady(provider = selectedProviderStatus()) { return !!(provider?.installed && provider?.loggedIn && !provider.limited); }
function timeLabel(ms) {
  const at = new Date(ms), today = at.toDateString() === new Date().toDateString();
  return `${today ? '' : `${at.getMonth() + 1}/${at.getDate()} `}${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
function aiNotReadyMessage() {
  const provider = selectedProviderStatus();
  if (provider?.limited) {
    const until = Math.max(...desktopStatus.providers.filter(isLimited).map(p => p.limitedUntil));
    return `${providerName()}は利用上限に達しています（${timeLabel(until)}ごろまで）。別のAIを選ぶか、時間をおいてください。`;
  }
  return `開始画面の「採点AI」で${providerName()}のインストールとログインを済ませてください。`;
}
/** 最後にAIを使ったときに各AIが知らせた使用量。80%以上は注意として目立たせる。 */
function renderUsage() {
  const line = document.getElementById('desktop-ai-usage');
  if (!line) return;
  const parts = [];
  for (const p of desktopStatus.providers) {
    if (!p.installed || !p.loggedIn) continue;
    const name = p.id === 'claude' ? 'Claude' : 'Codex';
    if (isLimited(p)) { parts.push({ text: `${name}：上限に達しています（${timeLabel(p.limitedUntil)}ごろまで）`, warn: true }); continue; }
    const windows = p.usage?.windows || [];
    if (!windows.length) { parts.push({ text: `${name}：使用量はまだ記録がありません（AIを使うと表示）` }); continue; }
    parts.push({ text: `${name}：` + windows.map(w => `${w.label ? w.label + ' ' : ''}${w.percent}%${w.resetsAt ? `（${timeLabel(w.resetsAt)}にリセット）` : ''}`).join('・') +
      (p.usage.updatedAt ? ` ［${timeLabel(p.usage.updatedAt)}時点］` : ''), warn: windows.some(w => w.percent >= 80) });
  }
  line.replaceChildren(...parts.flatMap((part, i) => {
    const span = document.createElement('span');
    span.textContent = part.text; if (part.warn) span.className = 'usage-warn';
    return i ? [document.createElement('br'), span] : [span];
  }));
  line.hidden = !parts.length;
}
function providerName() { return desktopProvider === 'double' ? 'ダブルチェック（Codex＋Claude）' : desktopProvider === 'claude' ? 'Claude' : 'Codex'; }
function desktopMessage(message) {
  const status = document.getElementById('desktop-ai-status');
  if (status) status.textContent = String(message || '').slice(0, 500);
}
function updateDesktopControls() {
  const panel = document.getElementById('desktop-ai-panel');
  const written = state.questions[state.index]?.questionType === '記述';
  if (panel) panel.hidden = !desktopBridge || !(currentScreen === 'start' || currentScreen === 'report' || (currentScreen === 'quiz' && written));
  const openReport = document.getElementById('open-report');
  if (openReport) openReport.hidden = !desktopBridge || currentScreen !== 'start';
  if (!desktopBridge) return;
  renderUpdateNotice();
  renderGenerateControls();
  renderReportControls();
  if (typeof Flashcards !== 'undefined') Flashcards.renderControls();
  const analysisStart = document.getElementById('analysis-start');
  if (analysisStart) { analysisStart.disabled = updateApplying || !!desktopOperation || desktopStatus.busy; const label = document.getElementById('analysis-provider'); if (label) label.textContent = `使うAI：${providerName()}（開始画面の「採点AI」で切り替え）`; }
  const provider = selectedProviderStatus();
  const operating = updateApplying || !!desktopOperation || desktopStatus.busy;
  const scoring = ['grade', 'saving', 'cancel'].includes(desktopOperation);
  const select = document.getElementById('desktop-ai-provider');
  if (select) { select.value = desktopProvider; select.disabled = operating; }
  const install = document.getElementById('desktop-ai-install');
  const login = document.getElementById('desktop-ai-login');
  const refresh = document.getElementById('desktop-ai-refresh');
  const cancel = document.getElementById('desktop-ai-cancel');
  const double = desktopProvider === 'double';
  const doubleOption = select?.querySelector?.('option[value="double"]');
  // 両方にログインするまでは選択肢自体を出さない（使えない機能は見せない）。
  if (doubleOption) { doubleOption.hidden = doubleOption.disabled = !doubleReady() && !double; doubleOption.textContent = 'ダブルチェック（Codex＋Claude）'; }
  // 利用上限に達したAIは、上限が戻るまで選択肢を灰色にする。
  for (const id of ['codex', 'claude']) {
    const option = select?.querySelector?.(`option[value="${id}"]`), row = desktopStatus.providers.find(p => p.id === id);
    if (!option) continue;
    const limited = isLimited(row);
    option.disabled = limited && desktopProvider !== id;
    option.textContent = (id === 'claude' ? 'Claude' : 'Codex') + (limited ? `（上限・${timeLabel(row.limitedUntil)}まで）` : '');
  }
  renderUsage();
  if (install) { install.hidden = double || !!provider?.installed; install.disabled = operating || !provider; }
  if (login) { login.hidden = double || !provider?.installed || !!provider?.loggedIn; login.disabled = operating; }
  if (refresh) refresh.disabled = updateApplying || !!desktopOperation;
  if (cancel) { cancel.hidden = !(desktopOperation || desktopStatus.busy) || desktopOperation === 'saving'; cancel.disabled = desktopOperation === 'cancel'; }
  // Claude's login page may show a code to paste back instead of finishing automatically.
  const codeRow = document.getElementById('desktop-ai-code-row');
  if (codeRow) {
    codeRow.hidden = !(desktopOperation === 'login' && desktopProvider === 'claude');
    if (codeRow.hidden) document.getElementById('desktop-ai-code').value = '';
  }
  const grade = document.getElementById('grade-written');
  const savedResult = !!document.getElementById('written-grade')?.value.trim();
  if (grade) {
    grade.hidden = state.answered;
    grade.disabled = operating || quizBusy || state.answered || (!savedResult && !aiReady(provider));
    grade.textContent = savedResult ? '採点結果を保存' : 'AIで採点';
  }
  const response = document.getElementById('written-response');
  if (response && written) response.readOnly = updateApplying || state.answered || scoring;
  const finish = document.getElementById('finish-session');
  if (finish) finish.disabled = scoring;
}
function describeDesktopStatus() {
  const provider = selectedProviderStatus();
  if (!provider) { desktopMessage('状態を確認してください。'); return; }
  if (desktopProvider === 'double') {
    desktopMessage(provider.loggedIn ? 'ダブルチェック：準備完了（CodexとClaudeの両方を使います）'
      : 'ダブルチェック：CodexとClaudeの両方にログインすると使えます。上の選択でそれぞれを選び、インストールとログインを済ませてください。');
    return;
  }
  const summary = !provider.installed ? 'インストールしてください。' : !provider.loggedIn ? 'ログインしてください。' : provider.limited ? `利用上限に達しています（${timeLabel(provider.limitedUntil)}ごろまで）。別のAIを選んでください。` : '準備完了';
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
    if (['codex', 'claude', 'double'].includes(saved)) desktopProvider = saved;
    aiMode = window.localStorage.getItem(AI_MODE_KEY) !== 'off';
  } catch (_) { /* Provider selection remains usable without preference storage. */ }
  const location = document.getElementById('storage-location');
  if (location) location.textContent = '問題・履歴はこのPCに保存されます。';
  const browserNote = document.getElementById('browser-format-note');
  if (browserNote) browserNote.hidden = true;
  const generatePanel = document.getElementById('ai-generate');
  if (generatePanel) generatePanel.hidden = false;
  applyAiMode();
  let usageRefresh = null;
  if (typeof desktopBridge.onProgress === 'function') desktopBridge.onProgress(event => {
    // AIの処理が終わったら、使用量・上限の表示を更新する（処理の終了を待ってから状態を読む）。
    if (['complete', 'error'].includes(event?.phase)) {
      clearTimeout(usageRefresh);
      usageRefresh = setTimeout(() => { if (!desktopOperation) refreshDesktopStatus().catch(() => {}); else updateDesktopControls(); }, 1500);
    }
    if (event?.provider && event.provider !== desktopProvider) return;
    const message = String(event?.message || '').slice(0, 4000);
    if (!message) return;
    desktopLog.push(message);
    desktopLog = desktopLog.slice(-12);
    const log = document.getElementById('desktop-ai-log');
    if (log) log.textContent = desktopLog.join('\n').slice(-4000);
    if (desktopOperation) desktopMessage(message);
    if (desktopOperation === 'generate') document.getElementById('ai-generate-status').textContent = message;
    if (desktopOperation === 'report') document.getElementById('report-status').textContent = message;
    if (desktopOperation === 'cards') document.getElementById('cards-ai-status').textContent = message;
  });
  desktopMessage('状態を確認中…');
  updateDesktopControls();
  // 上限の解除時刻を過ぎたら灰色表示を戻すため、1分ごとに表示だけ更新する（AIには問い合わせない）。
  if (typeof setInterval === 'function') setInterval(() => { if (!desktopOperation) updateDesktopControls(); }, 60 * 1000);
  try { await refreshDesktopStatus(); }
  catch (error) { desktopMessage(error.message || '状態を確認できません。'); }
}
/** 本人が「更新する」を押したときだけ更新する。確認の失敗は学習を妨げないよう表示しない。 */
function renderUpdateNotice() {
  const notice = document.getElementById('update-notice');
  if (!notice) return;
  notice.hidden = !updateOffer || currentScreen !== 'start';
  if (!updateOffer) return;
  const { kind, version, notes, important, required, action } = updateOffer;
  document.getElementById('update-title').textContent = kind === 'content'
    ? `新しい版 ${version} があります${important ? '（重要な修正）' : ''}`
    : `新しい版 ${version} があります${required ? '（入れ直しが必要な大きな更新）' : ''}`;
  document.getElementById('update-notes').textContent = notes || '';
  const apply = document.getElementById('update-apply');
  apply.textContent = kind === 'shell' && action === 'download' ? 'ダウンロードページを開く' : '更新する';
  apply.disabled = updateApplying || !!desktopOperation || desktopStatus.busy;
  document.getElementById('update-later').hidden = updateApplying;
}
async function checkForUpdate() {
  if (!desktopBridge?.checkUpdate) return;
  let result;
  try { result = await desktopBridge.checkUpdate(); } catch (_) { return; }
  const shell = result?.shell, content = result?.content;
  // 大きな更新で内容の更新が止まった場合だけ、本体の案内を優先する。
  if (shell && (shell.required || !content)) updateOffer = { kind: 'shell', ...shell };
  else if (content) updateOffer = { kind: 'content', ...content };
  else updateOffer = null;
  renderUpdateNotice();
}
async function applyUpdate() {
  if (!updateOffer || updateApplying || desktopOperation || desktopStatus.busy) return;
  const status = document.getElementById('update-status');
  const download = updateOffer.kind === 'shell' && updateOffer.action === 'download';
  updateApplying = true; updateDesktopControls();
  status.textContent = download ? '' : '更新を準備しています。学習記録はそのまま残ります…';
  let restarting = false;
  try {
    const result = await desktopBridge.applyUpdate({ kind: updateOffer.kind, version: updateOffer.version });
    restarting = !!result?.restarting;
    status.textContent = restarting ? 'まもなくアプリを再起動します。' : 'ダウンロードページを開きました。新しい版をインストールすると、学習記録はそのまま引き継がれます。';
  } catch (error) {
    status.textContent = error.message || '更新できませんでした。';
  } finally {
    // 再起動を待つ間はボタンを止めたままにする。
    if (!restarting) { updateApplying = false; updateDesktopControls(); }
  }
}
/** Word資料からアプリ内のAIで問題を作る（PC版のみ）。結果は自動登録せず「登録前の確認」に渡す。 */
function renderGenerateControls() {
  const start = document.getElementById('ai-generate-start');
  if (!start) return;
  const provider = selectedProviderStatus();
  const generating = desktopOperation === 'generate';
  const ready = aiReady(provider);
  start.disabled = updateApplying || !!desktopOperation || desktopStatus.busy || !generationSource;
  document.getElementById('ai-generate-cancel').hidden = !generating;
  document.getElementById('ai-generate-file').disabled = generating;
  document.getElementById('ai-generate-provider').textContent = ready
    ? `使うAI：${providerName()}（開始画面の「採点AI」で切り替え）`
    : aiNotReadyMessage();
}
async function chooseGenerationFile() {
  const input = document.getElementById('ai-generate-file');
  const info = document.getElementById('ai-generate-file-info');
  generationSource = null; info.textContent = '';
  const file = input.files?.[0];
  if (file) {
    try {
      generationSource = await DocumentReader.readForGeneration(file);
      const { text, red, skipped } = generationSource;
      const subject = document.getElementById('ai-generate-subject');
      if (!subject.value.trim()) subject.value = generationSource.filename.replace(/\.docx$/i, '').slice(0, 200);
      info.textContent = `本文 ${text.length.toLocaleString()} 文字・赤文字 ${red} か所` +
        (skipped.images || skipped.equations ? `。画像・図 ${skipped.images} 個、数式 ${skipped.equations} 個は読み取れないため使いません` : '') +
        (red ? '' : '。赤文字がないため、資料の答えや重要な用語から作ります');
    } catch (error) { input.value = ''; info.textContent = error.message || 'Wordファイルを読み取れません。'; }
  }
  renderGenerateControls();
}
async function generateQuestions() {
  if (!desktopBridge || updateApplying || desktopOperation || !generationSource) return;
  const status = document.getElementById('ai-generate-status');
  const provider = selectedProviderStatus();
  if (!aiReady(provider)) { status.textContent = aiNotReadyMessage(); return; }
  const subject = document.getElementById('ai-generate-subject').value.trim();
  const types = Array.from(document.querySelectorAll('input[name="ai-generate-type"]:checked')).map(box => box.value);
  if (!subject) { status.textContent = '科目名を入力してください。'; return; }
  if (!types.length) { status.textContent = '問題形式を1つ以上選んでください。'; return; }
  const run = ++desktopRun;
  desktopOperation = 'generate'; updateDesktopControls();
  status.textContent = '資料から問題を作っています。数分かかることがあります…';
  try {
    const result = await desktopBridge.generate({ provider: desktopProvider, subject, document: generationSource.filename, text: generationSource.text, rules: PackHelp.rules, count: Number(document.getElementById('ai-generate-count').value), types });
    if (run !== desktopRun) return;
    await SubjectManager.previewGenerated(result.pack, generationSource.filename);
    status.textContent = `${result.pack.questions.length} 問を作りました。下の「登録前の確認」で問題と正解を確かめてから登録してください。` +
      (result.dropped ? `\n形式が不正だった ${result.dropped} 問は除きました。` : '') + (result.notes ? `\nAIからの補足：${result.notes}` : '');
  } catch (error) {
    if (run === desktopRun) status.textContent = error.message || '問題を作れませんでした。';
  } finally {
    if (run === desktopRun) { desktopOperation = null; updateDesktopControls(); }
  }
}
/** レポートチェック（PC版のみ）。本文は書き換えず、行番号つきの指摘だけを表示する。 */
const reportLinesOf = text => text.replace(/\r\n?/g, '\n').split('\n');
function renderReportControls() {
  const start = document.getElementById('report-start');
  if (!start) return;
  const provider = selectedProviderStatus();
  const reporting = desktopOperation === 'report';
  start.disabled = updateApplying || !!desktopOperation || desktopStatus.busy || !document.getElementById('report-text').value.trim();
  document.getElementById('report-cancel').hidden = !reporting;
  document.getElementById('report-file').disabled = reporting;
  document.getElementById('report-text').readOnly = reporting;
  document.getElementById('report-provider').textContent = aiReady(provider)
    ? `使うAI：${providerName()}（上の「採点AI」で切り替え）`
    : aiNotReadyMessage();
}
function updateReportStats() {
  const text = document.getElementById('report-text').value;
  const lines = reportLinesOf(text);
  document.getElementById('report-stats').textContent = text.trim()
    ? `文字数（空白・改行を除く）${text.replace(/\s/g, '').length.toLocaleString()}字・段落 ${lines.filter(line => line.trim()).length}・行 ${lines.length}` : '';
  renderReportControls();
}
function openReportScreen() {
  showScreen('report');
  updateReportStats();
  updateDesktopControls();
}
async function chooseReportFile() {
  const input = document.getElementById('report-file');
  const info = document.getElementById('report-file-info');
  const file = input.files?.[0];
  info.textContent = '';
  if (!file) return;
  try {
    const result = await DocumentReader.readReport(file);
    document.getElementById('report-text').value = result.text;
    const { images, equations } = result.skipped;
    info.textContent = `${result.filename} を読み込みました。` + (images || equations ? `画像・図 ${images} 個、数式 ${equations} 個は読み取れないため、チェックの対象外です。` : '');
  } catch (error) { input.value = ''; info.textContent = error.message || 'ファイルを読み取れません。'; }
  updateReportStats();
}
function focusReportLine(line) {
  const panel = document.getElementById('report-lines-panel');
  panel.open = true;
  document.querySelectorAll('.report-line.is-focus').forEach(row => row.classList.remove('is-focus'));
  const row = document.getElementById(`report-line-${line}`);
  if (!row) return;
  row.classList.add('is-focus');
  row.scrollIntoView?.({ block: 'center' });
}
function renderReportResult(result, text) {
  const element = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; };
  document.getElementById('report-summary').textContent = (result.warning ? `※${result.warning}\n` : '') + (result.summary || '');
  const requirementPanel = document.getElementById('report-requirement-panel');
  requirementPanel.hidden = !result.requirements.length;
  document.getElementById('report-requirement-list').replaceChildren(...result.requirements.map(item => {
    const li = element('li');
    if (item.by) li.append(element('span', item.by, 'report-tag is-ai'));
    li.append(element('span', item.status, 'report-tag' + (item.status === '満たしている' ? '' : ' is-must')), element('strong', item.requirement), element('span', item.detail ? `：${item.detail}` : ''));
    return li;
  }));
  const must = result.issues.filter(issue => issue.severity === '要修正').length;
  const agreed = result.issues.filter(issue => issue.by?.length === 2).length;
  document.getElementById('report-issue-count').textContent = `${result.issues.length} 件（要修正 ${must}・推奨 ${result.issues.length - must}${result.double ? `・両方が指摘 ${agreed}` : ''}）` +
    (result.unverified ? ` ※本文に見つからなかった指摘 ${result.unverified} 件は除きました` : '');
  document.getElementById('report-issue-list').replaceChildren(...(result.issues.length ? result.issues.map(issue => {
    const li = element('li');
    const where = element('button', `${issue.line}行目・${issue.column}文字目`, 'link-button report-where');
    where.type = 'button';
    where.addEventListener('click', () => focusReportLine(issue.line));
    li.append(where, element('span', issue.category, 'report-tag' + (issue.severity === '要修正' ? ' is-must' : '')));
    if (issue.by) li.append(element('span', issue.by.length === 2 ? '両方が指摘' : `${issue.by[0]}のみ`, 'report-tag is-ai' + (issue.by.length === 2 ? ' is-agreed' : '')));
    li.append(element('span', `「${issue.quote}」`), element('br'), element('span', issue.problem + (issue.suggestion ? `　修正案：${issue.suggestion}` : '')));
    if (issue.second) li.append(element('br'), element('span', `（${issue.by[1]}）${issue.second.problem}${issue.second.suggestion ? `　修正案：${issue.second.suggestion}` : ''}`, 'muted'));
    return li;
  }) : [element('li', '指摘はありませんでした。')]));
  const flagged = new Set(result.issues.map(issue => issue.line));
  document.getElementById('report-lines').replaceChildren(...reportLinesOf(text).map((line, i) => {
    const row = element('div', undefined, 'report-line' + (flagged.has(i + 1) ? ' has-issue' : ''));
    row.id = `report-line-${i + 1}`;
    row.append(element('span', String(i + 1), 'report-no'), element('span', line || ' '));
    return row;
  }));
  document.getElementById('report-result').hidden = false;
}
async function checkReport() {
  if (!desktopBridge || updateApplying || desktopOperation) return;
  const status = document.getElementById('report-status');
  const provider = selectedProviderStatus();
  if (!aiReady(provider)) { status.textContent = aiNotReadyMessage(); return; }
  const text = document.getElementById('report-text').value;
  if (!text.trim()) { status.textContent = 'レポートの本文を入力してください。'; return; }
  const run = ++desktopRun;
  desktopOperation = 'report'; updateDesktopControls();
  document.getElementById('report-result').hidden = true;
  status.textContent = 'レポートをチェックしています。数分かかることがあります…';
  try {
    const result = await desktopBridge.checkReport({ provider: desktopProvider, report: text, requirements: document.getElementById('report-requirements').value, citation: document.getElementById('report-citation')?.value || 'auto' });
    if (run !== desktopRun) return;
    renderReportResult(result, text);
    status.textContent = `チェックが終わりました。指摘 ${result.issues.length} 件。`;
  } catch (error) {
    if (/利用上限/.test(error.message || '')) refreshDesktopStatus().catch(() => {});
    if (run === desktopRun) status.textContent = error.message || 'チェックできませんでした。';
  } finally {
    if (run === desktopRun) { desktopOperation = null; updateDesktopControls(); }
  }
}
/** AIモード（PC版）。オフのときはAIを使う機能を画面から隠す。 */
function applyAiMode() {
  const toggle = document.getElementById('ai-mode-toggle');
  if (toggle) toggle.hidden = !desktopBridge;
  const box = document.getElementById('ai-mode');
  if (box) box.checked = aiMode;
  document.body?.classList?.toggle('ai-off', !!desktopBridge && !aiMode);
}
async function changeAiMode() {
  if (updateApplying || desktopOperation || desktopStatus.busy) { applyAiMode(); notify('AIの処理が終わってから切り替えてください。'); return; }
  aiMode = !!document.getElementById('ai-mode')?.checked;
  try { window.localStorage.setItem(AI_MODE_KEY, aiMode ? 'on' : 'off'); } catch (_) { /* 今回の画面だけ切り替える。 */ }
  applyAiMode();
  if (!aiMode && currentScreen === 'report') await renderStart();
  else if (currentScreen === 'quiz' && state.questions[state.index]?.questionType === '記述' && !state.answered) {
    document.getElementById('written-transfer').hidden = aiMode;
  }
  updateDesktopControls();
}
/** 学習記録から、科目ごとの正答率と苦手な分野（科目/出典/箇所）を集計する。 */
async function collectAnalysis() {
  const byId = new Map(availableQuestions.map((q) => [q.id, q]));
  const subjects = new Map(), areas = new Map(), latest = new Map();
  let attempts = 0, correct = 0;
  for (const record of await Storage.getAnswers()) {
    const q = byId.get(record.questionId);
    if (!q) continue;
    attempts++; if (record.isCorrect) correct++;
    const subject = subjects.get(q.subject) || { name: q.subject, attempts: 0, correct: 0, recent: [] };
    subject.attempts++; if (record.isCorrect) subject.correct++; subject.recent.push(!!record.isCorrect);
    subjects.set(q.subject, subject);
    const key = `${q.subject} / ${q.source.document} / ${q.source.location}`;
    const area = areas.get(key) || { name: key, attempts: 0, correct: 0 };
    area.attempts++; if (record.isCorrect) area.correct++;
    areas.set(key, area);
    latest.set(q.id, record);
  }
  const rate = (a) => a.attempts ? a.correct / a.attempts : 0;
  const weak = [...areas.values()].filter((a) => a.attempts >= 3).sort((a, b) => rate(a) - rate(b) || b.attempts - a.attempts).slice(0, 10);
  const weakNames = new Set(weak.map((a) => a.name));
  const wrong = [...latest.entries()].filter(([, r]) => r.isCorrect === false).map(([id]) => byId.get(id))
    .sort((a, b) => Number(weakNames.has(`${b.subject} / ${b.source.document} / ${b.source.location}`)) - Number(weakNames.has(`${a.subject} / ${a.source.document} / ${a.source.location}`)));
  return { attempts, correct, subjects: [...subjects.values()].sort((a, b) => rate(a) - rate(b)), weak, areas: [...areas.values()], wrong, latest };
}
function analysisRow(name, attempts, correct, weak) {
  const row = document.createElement('div');
  row.className = 'analysis-row' + (weak ? ' is-weak' : '');
  const label = document.createElement('span'); label.className = 'name'; label.textContent = name;
  const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('span'); fill.style.width = `${attempts ? Math.round((correct / attempts) * 100) : 0}%`; bar.appendChild(fill);
  const value = document.createElement('span'); value.textContent = `${attempts ? Math.round((correct / attempts) * 100) : 0}%（${correct}/${attempts}）`;
  row.append(label, bar, value);
  return row;
}
async function openAnalysis() {
  const data = await collectAnalysis();
  document.getElementById('analysis-overall').textContent = data.attempts
    ? `これまでの回答 ${data.attempts} 回・正答率 ${Math.round((data.correct / data.attempts) * 100)}%`
    : 'まだ回答の記録がありません。問題を解くと、ここに正答率と苦手な分野が表示されます。';
  document.getElementById('analysis-subjects').replaceChildren(...data.subjects.map((s) => {
    const recent = s.recent.slice(-20), recentRate = Math.round((recent.filter(Boolean).length / recent.length) * 100);
    const row = analysisRow(s.name, s.attempts, s.correct, s.correct / s.attempts < 0.6);
    row.title = `最近${recent.length}回の正答率 ${recentRate}%`;
    return row;
  }));
  const weak = document.getElementById('analysis-weak');
  weak.replaceChildren(...(data.weak.length ? data.weak.map((a) => analysisRow(a.name, a.attempts, a.correct, a.correct / a.attempts < 0.6))
    : [Object.assign(document.createElement('p'), { className: 'muted', textContent: '3回以上解いた分野がまだありません。' })]));
  const ai = document.getElementById('analysis-ai');
  ai.hidden = !desktopBridge?.analyze;
  document.getElementById('analysis-result').replaceChildren();
  document.getElementById('analysis-status').textContent = '';
  showScreen('analysis');
  updateDesktopControls();
}
async function analyzeWithAi() {
  if (!desktopBridge || updateApplying || desktopOperation || desktopStatus.busy) return;
  const status = document.getElementById('analysis-status');
  const provider = selectedProviderStatus();
  if (!aiReady(provider)) { status.textContent = aiNotReadyMessage(); return; }
  const data = await collectAnalysis();
  if (!data.attempts) { status.textContent = 'まだ回答の記録がありません。'; return; }
  const areaOf = (q) => `${q.subject} / ${q.source.document} / ${q.source.location}`;
  const rate = (a) => a.correct / a.attempts;
  const areas = data.areas.sort((a, b) => rate(a) - rate(b) || b.attempts - a.attempts).slice(0, 30).map((a) => ({ area: a.name.slice(0, 600), attempts: a.attempts, correct: a.correct }));
  const samples = data.wrong.slice(0, 30).map((q) => ({ area: areaOf(q).slice(0, 600), text: q.text.slice(0, 2000),
    answer: String(q.questionType === '記述' ? q.answer : q.choices[q.answer]).slice(0, 2000), ...(q.explanation ? { explanation: q.explanation.slice(0, 2000) } : {}),
    ...(Number.isInteger(data.latest.get(q.id)?.selected) && q.choices[data.latest.get(q.id).selected] ? { chosen: q.choices[data.latest.get(q.id).selected].slice(0, 2000) } : {}) }));
  const run = ++desktopRun;
  desktopOperation = 'analyze'; updateDesktopControls();
  status.textContent = `${providerName()}が分析しています。1〜2分かかることがあります…`;
  const output = document.getElementById('analysis-result');
  output.replaceChildren();
  try {
    const result = await desktopBridge.analyze({ provider: desktopProvider, overall: { attempts: data.attempts, correct: data.correct }, areas, samples });
    if (run !== desktopRun) return;
    for (const section of result.sections) {
      const block = document.createElement('div'); block.className = 'why-section';
      const add = (tag, text) => { const node = document.createElement(tag); node.textContent = text; block.appendChild(node); };
      if (result.sections.length > 1) add('strong', `【${section.by}】`);
      add('p', section.summary);
      for (const p of section.patterns) add('p', `■ ${p.area}\n苦手な理由：${p.reason}\n対策：${p.advice}`);
      add('p', `これからの1週間：${section.plan}`);
      output.appendChild(block);
    }
    status.textContent = '分析ができました。' + (result.warning ? ` ${result.warning}` : '') + ' AIの分析は目安です。';
  } catch (error) {
    if (run === desktopRun) status.textContent = error.message || '分析できませんでした。';
  } finally {
    if (run === desktopRun) { desktopOperation = null; updateDesktopControls(); }
  }
}
function changeDesktopProvider() {
  if (!desktopBridge || updateApplying || desktopOperation || desktopStatus.busy) { updateDesktopControls(); return; }
  const value = document.getElementById('desktop-ai-provider').value;
  if (!['codex', 'claude', 'double'].includes(value)) return;
  const chosen = desktopStatus.providers.find(p => p.id === value);
  if (chosen && isLimited(chosen)) { document.getElementById('desktop-ai-provider').value = desktopProvider; desktopMessage(`${value === 'claude' ? 'Claude' : 'Codex'}は利用上限に達しています（${timeLabel(chosen.limitedUntil)}ごろまで）。`); return; }
  if (value === 'double' && !doubleReady()) { document.getElementById('desktop-ai-provider').value = desktopProvider; desktopMessage('ダブルチェックは、CodexとClaudeの両方にログインすると選べます。'); return; }
  desktopProvider = value;
  try { window.localStorage.setItem(AI_PROVIDER_KEY, value); } catch (_) { /* Keep the page selection. */ }
  desktopLog = [];
  const log = document.getElementById('desktop-ai-log');
  if (log) log.textContent = '';
  describeDesktopStatus(); updateDesktopControls();
}
async function setupDesktopProvider(action) {
  if (!desktopBridge || updateApplying || desktopOperation || desktopStatus.busy) return;
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
  const wasGenerating = desktopOperation === 'generate';
  const wasReporting = desktopOperation === 'report';
  const wasCards = desktopOperation === 'cards';
  const run = ++desktopRun;
  let cancelled = false;
  desktopOperation = 'cancel'; updateDesktopControls();
  try { await desktopBridge.cancel(); cancelled = true; desktopMessage('取り消しました。'); if (wasGenerating) document.getElementById('ai-generate-status').textContent = '問題の作成を取り消しました。'; if (wasReporting) document.getElementById('report-status').textContent = 'チェックを取り消しました。'; if (wasCards) document.getElementById('cards-ai-status').textContent = 'カードの作成を取り消しました。'; }
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
  report: document.getElementById('screen-report'),
  analysis: document.getElementById('screen-analysis'),
  cards: document.getElementById('screen-cards'),
};

function showScreen(name) {
  currentScreen = name;
  document.getElementById('retry-action').hidden = true;
  document.getElementById('retry-action').onclick = null;
  Object.keys(screens).forEach((key) => {
    screens[key].hidden = key !== name;
  });
  renderUpdateNotice();
  document.getElementById('show-tutorial').hidden = name !== 'start';
  screens[name].setAttribute('tabindex', '-1');
  screens[name].focus({ preventScroll: true });
  window.scrollTo(0, 0);
  updateDesktopControls();
}

/** 選んだ科目の中で、最後の回答が不正解だった問題。復習モードで使う。 */
async function wrongQuestions() {
  const latest = new Map();
  for (const record of await Storage.getAnswers()) {
    const previous = latest.get(record.questionId);
    if (!previous || String(record.answeredAt) >= String(previous.answeredAt)) latest.set(record.questionId, record);
  }
  return questionsInScope().filter(askable).filter((q) => latest.get(q.id)?.isCorrect === false);
}
/** 指定した問題だけで学習を始める（間違えた問題の復習）。 */
async function startWith(questions) {
  if (quizBusy || subjectBusy) return;
  quizBusy = true;
  try {
    await refreshQuestions();
    const ids = new Set(availableQuestions.filter(canAskQuestion).map((q) => q.id));
    state.questions = questions.filter((q) => ids.has(q.id)).sort(() => Math.random() - 0.5);
    state.index = 0; state.results = []; state.answered = false;
    if (!state.questions.length) { notify('復習できる問題がありません。'); return; }
    await renderQuestion();
    showScreen('quiz');
  } finally { quizBusy = false; updateDesktopControls(); }
}
async function reviewWrong() { await startWith(await wrongQuestions()); }
async function retryWrong() { await startWith(state.results.filter((r) => !r.isCorrect).map((r) => r.question)); }

async function startSession(count) {
  if (quizBusy || subjectBusy) return;
  quizBusy = true;
  try {
    await refreshQuestions();
    const progressAll = await Storage.getAllProgress();
    state.questions = Scheduler.selectQuestions(
      availableQuestions.filter(askable), progressAll, count, new Date(), state.subjects
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
  // 画像つきの問題（「この臓器の役割は？」など）。画像は問題データに埋め込まれている。
  const figure = document.getElementById('question-figure'), image = document.getElementById('question-image');
  if (figure && image) {
    figure.hidden = !question.image;
    if (question.image) { image.src = question.image.src; image.alt = question.image.alt; }
    else { image.removeAttribute?.('src'); image.alt = ''; }
  }
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
      // selected（選んだ選択肢の番号）は任意項目。苦手の分析で「何と取り違えたか」を見るために使う。
      questionId: question.id, isCorrect, answeredAt: now.toISOString(), selected,
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
  // AIモードがオフなら、自分のAIにコピーして採点結果を貼り付ける方法を使う。
  document.getElementById('written-transfer').hidden = aiMode;
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
  if (!question || updateApplying || desktopOperation || desktopStatus.busy) return;
  const response = document.getElementById('written-response').value;
  let draft = WrittenPractice.prepare(question, response);
  let raw = document.getElementById('written-grade').value || draft.resultText;
  let grade = null;
  if (raw) {
    try { grade = WrittenPractice.parseResult(raw, question, draft); }
    catch (_) { raw = ''; }
  }
  const provider = selectedProviderStatus();
  if (!grade && !aiReady(provider)) throw new Error(aiNotReadyMessage());
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
  if (result.question.image) {
    const image = document.createElement('img');
    image.className = 'question-thumb'; image.src = result.question.image.src; image.alt = result.question.image.alt;
    li.appendChild(image);
  }

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
  if (desktopBridge?.explain && !result.isCorrect) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'why-button ai-only'; button.textContent = 'なぜ間違えた？（AIが解説）';
    const output = document.createElement('div');
    output.className = 'why-result ai-only';
    button.addEventListener('click', safeAction(() => explainMistake(result, button, output)));
    li.append(button, output);
  }
  list.appendChild(li);
}

/** 間違えた理由をAIが解説する（PC版）。問題・解説・自分の答えだけを渡す。 */
async function explainMistake(result, button, output) {
  if (updateApplying || desktopOperation || desktopStatus.busy) { output.textContent = '別のAI処理が終わってからお試しください。'; return; }
  const provider = selectedProviderStatus();
  if (!aiReady(provider)) { output.textContent = aiNotReadyMessage(); return; }
  const run = ++desktopRun;
  desktopOperation = 'explain'; button.disabled = true;
  output.textContent = `${providerName()}が解説しています…`;
  try {
    const answer = await desktopBridge.explain({ provider: desktopProvider, question: result.question, selected: result.selected });
    if (run !== desktopRun) return;
    output.textContent = '';
    for (const section of answer.sections) {
      const block = document.createElement('div');
      block.className = 'why-section';
      const lines = [['なぜ誤りか', section.whyWrong], ['正解の理由', section.whyCorrect], ['覚え方', section.point]];
      if (answer.sections.length > 1) { const by = document.createElement('strong'); by.textContent = `【${section.by}】`; block.appendChild(by); }
      for (const [label, text] of lines) { const p = document.createElement('p'); p.textContent = `${label}：${text}`; block.appendChild(p); }
      output.appendChild(block);
    }
    if (answer.warning) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = answer.warning; output.appendChild(p); }
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'AIの解説には誤りもあります。講義資料と照らして確認してください。'; output.appendChild(note);
  } catch (error) {
    if (run === desktopRun) output.textContent = error.message || '解説できませんでした。';
  } finally {
    if (run === desktopRun) { desktopOperation = null; button.disabled = false; updateDesktopControls(); }
  }
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
  const retry = document.getElementById('retry-wrong');
  if (retry) { retry.hidden = wrong.length === 0; retry.textContent = `間違えた ${wrong.length} 問をもう一度`; }
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
      el.disabled = !questionsInScope().some(askable);
    });
  }
}

/** 選択中の科目で、何問が出題対象かを示す。 */
async function renderStartNote() {
  const progressAll = await Storage.getAllProgress();
  const now = new Date();
  const all = questionsInScope();
  const asked = all.filter(canAskQuestion);
  // 形式ごとの問題数を表示し、0問の形式は選べないようにする（選んでいた形式が0問になったら「すべて」に戻す）。
  const modeCounts = Object.fromEntries(Object.entries(QUESTION_MODES).map(([mode, type]) => [mode, type ? asked.filter((q) => q.questionType === type).length : asked.length]));
  const modeUsable = (mode) => mode === 'all' || (modeCounts[mode] > 0 && (mode !== 'written' || !!desktopBridge));
  if (!modeUsable(questionMode)) questionMode = 'all';
  const modeInputs = Array.from(document.getElementById('question-mode')?.querySelectorAll?.('input[name="question-mode"]') || []);
  if (modeInputs.length) {
    document.getElementById('question-mode-written').hidden = !desktopBridge;
    const labels = { all: 'すべて', choice: '選択問題だけ', truefalse: '正誤だけ', written: '記述だけ' };
    for (const input of modeInputs) {
      input.disabled = !modeUsable(input.value);
      input.checked = input.value === questionMode;
      input.nextElementSibling.textContent = `${labels[input.value]}（${modeCounts[input.value]}）`;
    }
  }
  const scope = asked.filter(inQuestionMode);
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
    (questionMode !== 'all' && scope.length ? `${{ choice: '選択問題', truefalse: '正誤問題', written: '記述問題' }[questionMode]}だけを出題します。` : '') +
    (scope.length ? `未出題 ${newCount} 問` : '出題できる問題がありません。') +
    (desktopOnly ? ` 記述 ${desktopOnly} 問はPC専用アプリで出題できます。` : '') +
    (recall ? ` 想起 ${recall} 問は保存のみ（出題未対応）。` : '');
  const review = document.getElementById('review-wrong');
  if (review) {
    const wrong = await wrongQuestions();
    review.hidden = wrong.length === 0;
    review.textContent = `間違えた問題だけ復習（${wrong.length} 問）`;
  }
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
  showVersion(null);
  // QRコードから開かれたときは、共有された問題の確認画面へ。
  if (typeof QuestionShare !== 'undefined') {
    try { await SubjectManager.receiveFromLocation(); } catch (error) { notify(error.message, true); }
  }
  // 起動できたことを本体へ伝える。伝えないまま終わった新しい版は、前の版へ自動で戻る。
  let running = null;
  if (desktopBridge?.started) {
    try { running = await desktopBridge.started(); showVersion(running); } catch (_) { /* 確認できなくても学習は続けられる。 */ }
    checkForUpdate();
  }
  // 更新後の初回起動なら、更新内容を表示する（初めて使う人には出さない）。
  if (typeof WhatsNew !== 'undefined' && currentScreen === 'start') {
    try {
      const returning = (await Storage.getImportedQuestions()).length > 0 || (await Storage.getAnswers()).length > 0;
      WhatsNew.showIfUpdated(running?.version || null, returning);
    } catch (_) { /* 表示できなくても学習は続けられる。 */ }
  }
}
/** 画面下にバージョンを表示する。PC版は動作中の版（内容の更新を含む）、Web版は更新日。 */
function showVersion(info) {
  const label = document.getElementById('app-version');
  if (!label) return;
  const built = label.dataset?.built;
  if (info?.version) label.textContent = `バージョン ${info.version}` + (info.installed && info.installed !== info.version ? `（本体 ${info.installed}）` : '');
  else if (!desktopBridge && built && built !== '__BUILD_DATE__') label.textContent = `Web版（${built} 更新）`;
}

document.getElementById('next').addEventListener('click', safeAction(goNext));
document.getElementById('restart').addEventListener('click', safeAction(renderStart));
document.getElementById('retry-wrong')?.addEventListener('click', safeAction(retryWrong));
document.getElementById('review-wrong')?.addEventListener('click', safeAction(reviewWrong));
document.getElementById('open-analysis')?.addEventListener('click', safeAction(openAnalysis));
document.getElementById('analysis-back')?.addEventListener('click', safeAction(renderStart));
document.getElementById('analysis-start')?.addEventListener('click', safeAction(analyzeWithAi));
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
document.getElementById('update-apply')?.addEventListener('click', applyUpdate);
document.getElementById('ai-mode')?.addEventListener('change', safeAction(changeAiMode));
document.getElementById('question-mode')?.addEventListener('change', safeAction(changeQuestionMode));
document.getElementById('open-whats-new')?.addEventListener('click', () => WhatsNew.showAll());
document.getElementById('whats-new-close')?.addEventListener('click', () => WhatsNew.close());
document.getElementById('whats-new')?.addEventListener('close', () => WhatsNew.close());
document.getElementById('ai-generate-file')?.addEventListener('change', safeAction(chooseGenerationFile));
document.getElementById('ai-generate-start')?.addEventListener('click', generateQuestions);
document.getElementById('ai-generate-cancel')?.addEventListener('click', cancelDesktopOperation);
document.getElementById('open-report')?.addEventListener('click', openReportScreen);
document.getElementById('report-back')?.addEventListener('click', safeAction(renderStart));
document.getElementById('report-file')?.addEventListener('change', safeAction(chooseReportFile));
document.getElementById('report-text')?.addEventListener('input', () => { document.getElementById('report-result').hidden = true; updateReportStats(); });
document.getElementById('report-start')?.addEventListener('click', checkReport);
document.getElementById('report-cancel')?.addEventListener('click', cancelDesktopOperation);
document.getElementById('update-later')?.addEventListener('click', () => { updateOffer = null; renderUpdateNotice(); });
document.getElementById('desktop-ai-refresh')?.addEventListener('click', safeAction(refreshDesktopStatus));
document.getElementById('desktop-ai-install')?.addEventListener('click', () => setupDesktopProvider('install'));
document.getElementById('desktop-ai-login')?.addEventListener('click', () => setupDesktopProvider('login'));
document.getElementById('desktop-ai-cancel')?.addEventListener('click', cancelDesktopOperation);
document.getElementById('desktop-ai-code-submit')?.addEventListener('click', async () => {
  const input = document.getElementById('desktop-ai-code');
  if (!desktopBridge || desktopOperation !== 'login' || !input?.value.trim()) return;
  const button = document.getElementById('desktop-ai-code-submit');
  if (button.disabled) return;
  button.disabled = true;
  const code = input.value.trim(); input.value = '';
  try { await desktopBridge.submitLoginCode(code); }
  catch (error) { desktopMessage(error.message || '認証コードを送信できませんでした。'); }
  finally { button.disabled = false; }
});
if (typeof Flashcards !== 'undefined') Flashcards.initialize({
  showScreen, renderStart, notify, safeAction,
  desktop: () => !!desktopBridge?.makeCards,
  provider: () => desktopProvider,
  providerName,
  providerReady: () => aiReady(),
  notReadyMessage: aiNotReadyMessage,
  busy: () => updateApplying || !!desktopOperation || desktopStatus.busy,
  running: (name) => desktopOperation === name,
  // AI処理の開始・終了は、採点などと同じ1つの状態で管理する（同時に2つ動かさない）。
  begin(name) { if (updateApplying || desktopOperation || desktopStatus.busy) return 0; const run = ++desktopRun; desktopOperation = name; updateDesktopControls(); return run; },
  current: (run) => run === desktopRun,
  end(run) { if (run === desktopRun) { desktopOperation = null; updateDesktopControls(); } },
  cancel: cancelDesktopOperation,
});
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
