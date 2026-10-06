/** 自作問題の一時編集。保存と登録検査は呼び出し側に任せる。 */
const QuestionEditor = (() => {
  'use strict';

  let api = {};
  let container;
  let fields;
  let questions = [];
  let editingId = null;
  let nextNumber = 1;
  let busy = false;
  let generation = 0;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, id, className) {
    const node = element('button', text, className);
    node.type = 'button';
    if (id) node.id = id;
    return node;
  }
  function error(message, target) {
    fields.error.textContent = message;
    fields.error.hidden = !message;
    if (target) target.focus();
  }
  function changed() {
    error('');
    if (typeof api.onChange === 'function') api.onChange();
  }
  function makeId() {
    const random = typeof crypto === 'object' ? crypto : null;
    if (random && typeof random.randomUUID === 'function') return 'manual-' + random.randomUUID();
    if (random && typeof random.getRandomValues === 'function') {
      return 'manual-' + Array.from(random.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
    }
    return 'manual-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function setBusy(value) {
    busy = value;
    container.querySelectorAll('input, textarea, button').forEach(node => { node.disabled = value; });
    fields.preview.disabled = value || !questions.length;
  }
  function clearQuestion() {
    editingId = null;
    fields.text.value = '';
    fields.choices.forEach(input => { input.value = ''; });
    fields.answers.forEach(input => { input.checked = false; });
    fields.explanation.value = '';
    fields.source.value = '';
    fields.location.value = '';
    fields.add.textContent = '問題を追加';
    fields.cancel.hidden = true;
  }
  function hasUnaddedInput() {
    return editingId !== null || [fields.text, ...fields.choices, fields.explanation, fields.source, fields.location]
      .some(input => input.value.trim()) || fields.answers.some(input => input.checked);
  }
  function renderList() {
    fields.list.replaceChildren();
    fields.count.textContent = `作成中 ${questions.length} 問`;
    fields.count.hidden = !questions.length;
    questions.forEach((entry, index) => {
      const item = element('li', undefined, 'preview-question');
      item.append(element('p', `${index + 1}. ${entry.question.text}`));
      item.append(element('p', `正解：${entry.question.choices[entry.question.answer]}`, 'preview-answer'));
      const actions = element('div', undefined, 'actions');
      const edit = button('編集');
      edit.addEventListener('click', () => {
        if (busy) return;
        if (hasUnaddedInput()) { error('入力中の問題を追加するか、取り消してください。', fields.add); return; }
        const q = entry.question;
        editingId = q.id;
        fields.text.value = q.text;
        fields.choices.forEach((input, i) => { input.value = q.choices[i] || ''; });
        fields.answers.forEach((input, i) => { input.checked = i === q.answer; });
        fields.explanation.value = q.explanation || '';
        fields.source.value = entry.customSource ? q.source.document : '';
        fields.location.value = entry.customSource ? String(q.source.location) : '';
        fields.add.textContent = '変更を反映';
        fields.cancel.hidden = false;
        changed();
        fields.text.focus();
      });
      const remove = button('削除', undefined, 'danger');
      remove.addEventListener('click', () => {
        if (busy) return;
        questions = questions.filter(row => row.question.id !== entry.question.id);
        if (editingId === entry.question.id) clearQuestion();
        changed();
        renderList();
      });
      actions.append(edit, remove);
      item.append(actions);
      fields.list.append(item);
    });
    fields.preview.disabled = busy || !questions.length;
  }
  function addQuestion() {
    if (busy) return;
    const subject = fields.subject.value.trim();
    if (!subject) { error('科目名を入力してください。', fields.subject); return; }
    const text = fields.text.value.trim();
    if (!text) { error('問題文を入力してください。', fields.text); return; }
    const values = fields.choices.map(input => input.value.trim());
    const missing = values.slice(0, 2).findIndex(value => !value);
    if (missing !== -1) { error('選択肢1・2を入力してください。', fields.choices[missing]); return; }
    const selected = fields.answers.findIndex(input => input.checked);
    if (selected === -1) { error('正解を1つ選んでください。', fields.answers[0]); return; }
    if (!values[selected]) { error('正解に選んだ選択肢が空です。', fields.choices[selected]); return; }
    const choices = values.filter(Boolean);
    if (new Set(choices).size !== choices.length) { error('同じ選択肢は使えません。', fields.choices[0]); return; }
    const sourceName = fields.source.value.trim();
    const location = fields.location.value.trim();
    if (Boolean(sourceName) !== Boolean(location)) {
      error('出典の資料名と箇所を入力してください。', sourceName ? fields.location : fields.source);
      return;
    }
    const previous = questions.find(entry => entry.question.id === editingId);
    const number = previous ? previous.number : nextNumber;
    const question = {
      id: previous ? previous.question.id : makeId(),
      subject,
      source: sourceName ? { document: sourceName, location } : { document: '自作問題', location: `問題${number}` },
      format: 'その他',
      questionType: JSON.stringify(choices) === JSON.stringify(['正しい', '誤り']) ? '正誤' : '選択肢',
      text,
      choices,
      answer: values.slice(0, selected).filter(Boolean).length,
    };
    const explanation = fields.explanation.value.trim();
    if (explanation) question.explanation = explanation;
    const entry = { question, number, customSource: Boolean(sourceName) };
    if (previous) questions[questions.indexOf(previous)] = entry;
    else { questions.push(entry); nextNumber++; }
    fields.subject.value = subject;
    clearQuestion();
    changed();
    renderList();
    fields.text.focus();
  }
  async function preview() {
    if (busy) return;
    const subject = fields.subject.value.trim();
    if (!subject) { error('科目名を入力してください。', fields.subject); return; }
    if (hasUnaddedInput()) { error('入力中の問題を追加するか、取り消してください。', fields.add); return; }
    if (!questions.length) { error('問題を1つ以上追加してください。', fields.text); return; }
    const pack = {
      schemaVersion: 1,
      subject,
      questions: questions.map(entry => ({ ...entry.question, subject, source: { ...entry.question.source }, choices: [...entry.question.choices] })),
    };
    const request = generation;
    error('');
    setBusy(true);
    try {
      changed();
      await api.onPreview(pack);
    }
    catch (e) {
      if (request === generation) error(e.message || '内容を確認できませんでした。もう一度お試しください。');
    } finally {
      if (request === generation) setBusy(false);
    }
  }
  function initialize(options) {
    api = options || {};
    container = document.getElementById('manual-editor');
    if (!container) return;
    generation++;
    container.replaceChildren();
    fields = {};
    container.append(element('p', '未登録の問題は再読み込みで消えます。', 'muted'));
    function inputField(parent, name, label, multiline = false) {
      const wrapper = element('div', undefined, 'manual-field');
      const title = element('label', label, 'field-label');
      title.htmlFor = `manual-${name}`;
      const input = element(multiline ? 'textarea' : 'input', undefined, 'manual-input');
      input.id = title.htmlFor;
      if (multiline) input.rows = name === 'text' ? 3 : 2;
      else input.type = 'text';
      input.addEventListener('input', () => {
        if (busy) return;
        fields.cancel.hidden = !hasUnaddedInput();
        changed();
      });
      wrapper.append(title, input);
      parent.append(wrapper);
      return input;
    }
    fields.subject = inputField(container, 'subject', '科目名');
    const form = element('form', undefined, 'manual-question-form');
    form.noValidate = true;
    form.addEventListener('submit', event => { event.preventDefault(); addQuestion(); });
    fields.text = inputField(form, 'text', '問題文', true);
    const optionsGroup = element('fieldset', undefined, 'manual-choices');
    optionsGroup.append(element('legend', '選択肢・正解'));
    fields.choices = [];
    fields.answers = [];
    for (let i = 0; i < 4; i++) {
      const row = element('div', undefined, 'manual-choice');
      const answerLabel = element('label', undefined, 'manual-answer');
      const radio = element('input');
      radio.type = 'radio'; radio.name = 'manual-answer'; radio.value = String(i);
      radio.id = `manual-answer-${i + 1}`;
      radio.setAttribute('aria-label', `選択肢${i + 1}を正解にする`);
      radio.addEventListener('change', () => { if (!busy) { fields.cancel.hidden = false; changed(); } });
      answerLabel.append(radio, element('span', '正解'));
      row.append(answerLabel);
      const input = inputField(row, `choice-${i + 1}`, `選択肢${i + 1}${i > 1 ? '（任意）' : ''}`);
      fields.answers.push(radio); fields.choices.push(input);
      optionsGroup.append(row);
    }
    form.append(optionsGroup);
    fields.explanation = inputField(form, 'explanation', '解説（任意）', true);
    fields.source = inputField(form, 'source', '出典の資料名（任意）');
    fields.location = inputField(form, 'location', '出典のページ・箇所（任意）');
    fields.error = element('p', '', 'error-list');
    fields.error.setAttribute('role', 'alert');
    fields.error.hidden = true;
    form.append(fields.error);
    const actions = element('div', undefined, 'actions');
    fields.add = button('問題を追加', 'manual-add', 'primary');
    fields.add.type = 'submit';
    fields.cancel = button('入力を取り消す', 'manual-cancel-edit');
    fields.cancel.hidden = true;
    fields.cancel.addEventListener('click', () => {
      if (busy) return;
      clearQuestion(); changed(); fields.text.focus();
    });
    actions.append(fields.add, fields.cancel);
    form.append(actions);
    container.append(form);
    fields.count = element('h3');
    fields.list = element('ol', undefined, 'manual-question-list');
    fields.preview = button('内容を確認', 'manual-preview', 'primary');
    fields.preview.addEventListener('click', preview);
    container.append(fields.count, fields.list, fields.preview);
    reset();
  }
  function reset() {
    generation++;
    questions = [];
    nextNumber = 1;
    editingId = null;
    busy = false;
    if (!fields || !container) return;
    fields.subject.value = '';
    clearQuestion();
    error('');
    renderList();
    setBusy(false);
  }
  return { initialize, reset };
})();
