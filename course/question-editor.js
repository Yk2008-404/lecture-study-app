/** 問題に付ける画像の縮小。保存容量を抑えるため、長辺900pxのJPEG（data URI）にする。 */
const ImageTools = (() => {
  'use strict';
  async function shrink(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error(`画像が大きすぎます：${file.name || '画像'}`);
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch (_) { throw new Error(`画像を読み取れません：${file.name || '画像'}`); }
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.8);
  }
  return { shrink };
})();

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
  let image = null;
  const allowWritten = !!window.studyDesktop;

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
    container.querySelectorAll('input, textarea, select, button').forEach(node => { node.disabled = value; });
    fields.preview.disabled = value || !questions.length;
  }
  function isWritten() { return allowWritten && fields.type.value === '記述'; }
  function updateType() {
    const written = isWritten();
    fields.choicesGroup.hidden = written;
    fields.modelGroup.hidden = !written;
    fields.modelAnswer.required = written;
    fields.explanationLabel.textContent = written ? '解説・採点のポイント（任意）' : '解説（任意）';
  }
  function clearQuestion() {
    editingId = null;
    fields.text.value = '';
    fields.choices.forEach(input => { input.value = ''; });
    fields.answers.forEach(input => { input.checked = false; });
    fields.modelAnswer.value = '';
    fields.explanation.value = '';
    fields.source.value = '';
    fields.location.value = '';
    setImage(null);
    fields.add.textContent = '問題を追加';
    fields.cancel.hidden = true;
    updateType();
  }
  function hasUnaddedInput() {
    return editingId !== null || !!image || [fields.text, ...fields.choices, fields.modelAnswer, fields.explanation, fields.source, fields.location]
      .some(input => input.value.trim()) || fields.answers.some(input => input.checked);
  }
  function renderList() {
    fields.list.replaceChildren();
    fields.count.textContent = `作成中 ${questions.length} 問`;
    fields.count.hidden = !questions.length;
    questions.forEach((entry, index) => {
      const item = element('li', undefined, 'preview-question');
      item.append(element('p', `${index + 1}. ${entry.question.text}${entry.question.image ? '（画像あり）' : ''}`));
      const q = entry.question;
      item.append(element('p', q.questionType === '記述' ? `模範解答：${q.answer}` : `正解：${q.choices[q.answer]}`, 'preview-answer'));
      const actions = element('div', undefined, 'actions');
      const edit = button('編集');
      edit.addEventListener('click', () => {
        if (busy) return;
        if (hasUnaddedInput()) { error('入力中の問題を追加するか、取り消してください。', fields.add); return; }
        const q = entry.question;
        editingId = q.id;
        fields.type.value = q.questionType === '記述' ? '記述' : '選択肢';
        fields.text.value = q.text;
        fields.choices.forEach((input, i) => { input.value = q.choices[i] || ''; });
        fields.answers.forEach((input, i) => { input.checked = i === q.answer; });
        fields.modelAnswer.value = q.questionType === '記述' ? q.answer : '';
        fields.explanation.value = q.explanation || '';
        fields.source.value = entry.customSource ? q.source.document : '';
        fields.location.value = entry.customSource ? String(q.source.location) : '';
        setImage(q.image?.src || null);
        fields.imageAlt.value = q.image?.alt || '';
        fields.add.textContent = '変更を反映';
        fields.cancel.hidden = false;
        updateType();
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
    if (!allowWritten && fields.type.value === '記述') { error('記述問題はPC専用アプリで作成できます。', fields.type); return; }
    const subject = fields.subject.value.trim();
    if (!subject) { error('科目名を入力してください。', fields.subject); return; }
    const text = fields.text.value.trim();
    if (!text) { error('問題文を入力してください。', fields.text); return; }
    const written = isWritten();
    let choices = [], answer;
    if (written) {
      answer = fields.modelAnswer.value.trim();
      if (!answer) { error('模範解答を入力してください。', fields.modelAnswer); return; }
    } else {
      const values = fields.choices.map(input => input.value.trim());
      const missing = values.slice(0, 2).findIndex(value => !value);
      if (missing !== -1) { error('選択肢1・2を入力してください。', fields.choices[missing]); return; }
      const selected = fields.answers.findIndex(input => input.checked);
      if (selected === -1) { error('正解を1つ選んでください。', fields.answers[0]); return; }
      if (!values[selected]) { error('正解に選んだ選択肢が空です。', fields.choices[selected]); return; }
      choices = values.filter(Boolean);
      if (new Set(choices).size !== choices.length) { error('同じ選択肢は使えません。', fields.choices[0]); return; }
      answer = values.slice(0, selected).filter(Boolean).length;
    }
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
      questionType: written ? '記述' : (JSON.stringify(choices) === JSON.stringify(['正しい', '誤り']) ? '正誤' : '選択肢'),
      text,
      choices,
      answer,
    };
    const explanation = fields.explanation.value.trim();
    if (explanation) question.explanation = explanation;
    if (image) {
      const alt = fields.imageAlt.value.trim();
      if (!alt) { error('画像の説明を入力してください（画像が表示できないときに使います）。', fields.imageAlt); return; }
      question.image = { src: image, alt };
    }
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
    const labels = {};
    container.append(element('p', '未登録の問題は再読み込みで消えます。', 'muted'));
    function inputField(parent, name, label, multiline = false) {
      const wrapper = element('div', undefined, 'manual-field');
      const title = element('label', label, 'field-label');
      title.htmlFor = `manual-${name}`;
      title.id = `manual-${name}-label`;
      labels[name] = title;
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
    const typeGroup = element('div', undefined, 'manual-field');
    const typeLabel = element('label', '形式', 'field-label');
    typeLabel.htmlFor = 'manual-type';
    fields.type = element('select', undefined, 'manual-input');
    fields.type.id = 'manual-type';
    (allowWritten ? ['選択肢', '記述'] : ['選択肢']).forEach(value => {
      const option = element('option', value); option.value = value; fields.type.append(option);
    });
    fields.type.value = '選択肢';
    fields.type.addEventListener('change', () => {
      if (busy) return;
      updateType();
      fields.cancel.hidden = !hasUnaddedInput();
      changed();
    });
    typeGroup.append(typeLabel, fields.type);
    typeGroup.hidden = !allowWritten;
    form.append(typeGroup);
    fields.text = inputField(form, 'text', '問題文', true);
    const imageGroup = element('div', undefined, 'manual-field manual-image');
    const imageLabel = element('label', '画像（任意）', 'field-label');
    imageLabel.htmlFor = 'manual-image-file';
    fields.imageFile = element('input');
    fields.imageFile.type = 'file'; fields.imageFile.id = 'manual-image-file';
    fields.imageFile.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fields.imageFile.addEventListener('change', () => { const file = fields.imageFile.files?.[0]; if (file) attachImage(file); });
    const hint = element('p', '画像ファイルを選ぶか、コピーした画像（スクリーンショットなど）をこの画面で貼り付け（Ctrl+V／⌘+V）できます。', 'muted');
    fields.imagePreview = element('img', undefined, 'question-thumb');
    fields.imagePreview.alt = '';
    imageGroup.append(imageLabel, fields.imageFile, hint, fields.imagePreview);
    fields.imageAlt = inputField(imageGroup, 'image-alt', '画像の説明（例：心臓の断面図。矢印で1か所を示している）');
    fields.imageRemove = button('画像を外す');
    fields.imageRemove.addEventListener('click', () => { if (!busy) { setImage(null); changed(); } });
    imageGroup.append(fields.imageRemove);
    form.append(imageGroup);
    // コピーした画像の貼り付け。問題を作成中のときだけ受け付ける。
    form.addEventListener('paste', event => {
      const file = Array.from(event.clipboardData?.files || []).find(f => /^image\//.test(f.type));
      if (file && !busy) { event.preventDefault(); attachImage(file); }
    });
    const optionsGroup = element('fieldset', undefined, 'manual-choices');
    fields.choicesGroup = optionsGroup;
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
    fields.modelGroup = element('div');
    fields.modelGroup.id = 'manual-model-answer-group';
    fields.modelAnswer = inputField(fields.modelGroup, 'model-answer', '模範解答', true);
    form.append(fields.modelGroup);
    fields.explanation = inputField(form, 'explanation', '解説（任意）', true);
    fields.explanationLabel = labels.explanation;
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
  function setImage(src) {
    image = src || null;
    if (!fields?.imagePreview) return;
    fields.imagePreview.hidden = !image;
    if (image) fields.imagePreview.src = image; else fields.imagePreview.removeAttribute?.('src');
    fields.imageRemove.hidden = !image;
    if (fields.imageAlt.parentNode) fields.imageAlt.parentNode.hidden = !image;
    if (!image) { fields.imageAlt.value = ''; if (fields.imageFile) fields.imageFile.value = ''; }
  }
  async function attachImage(file) {
    const current = generation;
    try {
      const src = await ImageTools.shrink(file);
      if (current !== generation) return;
      setImage(src);
      fields.cancel.hidden = false;
      changed();
      fields.imageAlt.focus();
    } catch (e) { error(e.message || '画像を読み取れません。', fields.imageFile); }
  }
  function reset() {
    generation++;
    questions = [];
    nextNumber = 1;
    editingId = null;
    busy = false;
    if (!fields || !container) return;
    fields.subject.value = '';
    fields.type.value = '選択肢';
    clearQuestion();
    error('');
    renderList();
    setBusy(false);
  }
  return { initialize, reset };
})();
