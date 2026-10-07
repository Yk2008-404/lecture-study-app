/** 科目追加・プレビュー・書き出し・削除の画面。保存は必ずStorageを経由する。 */
const SubjectManager = (() => {
  'use strict';
  let app;
  let draft = null;
  let revision = 0;
  let busy = false;
  let deleteTarget = null;
  let inputFilename = '';
  let inputOrigin = 'file';
  let draftOrigin = null;
  const $ = (id) => document.getElementById(id);
  const canAsk = q => QuestionPacks.supported(q) && (q.questionType !== '記述' || !!window.studyDesktop);
  const playableCount = questions => questions.filter(canAsk).length;
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function invalidate() {
    revision++;
    draft = null;
    draftOrigin = null;
    $('pack-preview').hidden = true;
    $('pack-errors').hidden = true;
    $('register-pack').disabled = true;
  }
  function errors(items) {
    $('pack-error-list').replaceChildren(...items.map((item) => element('li', `${item.path}：${item.reason}`)));
    $('pack-errors').hidden = false;
  }
  function setBusy(value) {
    busy = value;
    ['validate-pack', 'register-pack', 'pack-file', 'pack-input', 'cancel-pack', 'manager-back', 'open-pack-help'].forEach((id) => { $(id).disabled = value; });
    if (!value && !draft) $('register-pack').disabled = true;
    const editor = $('manual-create');
    if (editor) editor.inert = value;
  }
  async function refresh() {
    const imported = await Storage.getImportedQuestions();
    const builtSubjects = new Set(app.builtIns.map((q) => q.subject));
    const subjects = [...new Set([...builtSubjects, ...imported.map((q) => q.subject)])];
    const container = $('managed-subjects');
    container.replaceChildren();
    if (!subjects.length) container.append(element('p', '登録済みの科目はまだない。上の入力欄から問題セットを追加できる。', 'muted'));
    subjects.forEach((subject) => {
      const extra = imported.filter((q) => q.subject === subject);
      const baseCount = app.builtIns.filter((q) => q.subject === subject).length;
      const card = element('article', undefined, 'panel subject-card');
      card.dataset.subject = subject;
      card.append(element('h3', subject));
      card.append(element('p', builtSubjects.has(subject) ? `組込 ${baseCount} 問 ＋ 追加 ${extra.length} 問` : `登録問題 / ${extra.length} 問`));
      const recall = extra.filter((q) => !QuestionPacks.supported(q)).length;
      if (recall) card.append(element('p', `想起 ${recall} 問は保存のみ。出題は未対応。`, 'muted'));
      const written = extra.filter(q => q.questionType === '記述').length;
      if (written && !window.studyDesktop) card.append(element('p', `記述 ${written} 問は保存済み。出題はPC専用アプリで。`, 'muted'));
      const scope = element('p', `書き出し対象：登録問題 ${extra.length} 問。学習履歴は含まれない。` + (baseCount ? '組込問題は含まれない。' : ''), 'export-scope');
      card.append(scope);
      if (!extra.length) card.append(element('p', '追加分が0問のため書き出せない。組込科目は削除できない。', 'muted'));
      const actions = element('div', undefined, 'actions');
      const exportButton = element('button', `問題 ${extra.length} 問を書き出す`);
      exportButton.type = 'button';
      exportButton.dataset.exportSubject = subject;
      exportButton.disabled = extra.length === 0;
      exportButton.addEventListener('click', app.safeAction(async () => {
        const pack = await Storage.exportSubject(subject);
        download(pack);
        app.notify(`${subject}の登録問題 ${pack.questions.length} 問をJSONとして書き出した。学習履歴は含まれない。`);
        await refresh();
      }));
      actions.append(exportButton);
      if (typeof QuestionShare !== 'undefined' && extra.some(QuestionShare.shareable)) {
        const shareButton = element('button', 'QRコードで共有');
        shareButton.type = 'button';
        shareButton.dataset.shareSubject = subject;
        shareButton.addEventListener('click', app.safeAction(() => openShare(subject)));
        actions.append(shareButton);
      }
      if (extra.length) {
        const remove = element('button', builtSubjects.has(subject) ? '追加分だけを削除' : '科目を削除', 'danger');
        remove.type = 'button';
        remove.dataset.deleteSubject = subject;
        remove.addEventListener('click', app.safeAction(() => requestDelete(subject)));
        actions.append(remove);
      }
      card.append(actions);
      container.append(card);
    });
  }
  function download(pack) {
    const blob = new Blob([JSON.stringify(pack, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = element('a');
    const name = pack.subject.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80).replace(/[. ]+$/, '');
    anchor.download = `problem-set-${name || 'subject'}.json`;
    anchor.href = url;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function preview() {
    if (busy) return;
    draft = null;
    $('pack-preview').hidden = true;
    $('pack-errors').hidden = true;
    const requestRevision = revision;
    const input = $('pack-input').value;
    setBusy(true);
    try {
      const parsed = typeof QuestionImport !== 'undefined'
        ? QuestionImport.parse(input, { filename: inputFilename }) : { pack: QuestionPacks.parse(input), warnings: [] };
      const result = await Storage.validateImport(JSON.stringify(parsed.pack));
      if (requestRevision !== revision) return;
      if (!result.ok) { errors(result.errors); return; }
      const imported = await Storage.getImportedQuestions();
      if (requestRevision !== revision) return;
      draft = result.pack;
      draftOrigin = inputOrigin;
      const warnings = $('import-warnings');
      if (warnings) {
        const messages = parsed.warnings.slice();
        if (!window.studyDesktop && result.summary.written) messages.push(`記述 ${result.summary.written} 問も保存します。出題はPC専用アプリで利用できます。`);
        warnings.replaceChildren(...messages.map(message => element('li', message)));
        warnings.hidden = !messages.length;
      }
      const s = result.summary;
      const exists = app.builtIns.concat(imported).some((q) => q.subject === draft.subject);
      $('preview-subject').textContent = `${draft.subject} / ${exists ? '既存科目への追加' : '新規科目'}`;
      $('preview-counts').textContent = `全 ${s.total} 問 / 選択肢 ${s.choice}・正誤 ${s.trueFalse}・記述${window.studyDesktop ? '' : '（PC専用）'} ${s.written || 0}・想起（未対応）${s.recall} / 出題可能 ${playableCount(draft.questions)} 問`;
      $('preview-history').textContent = `旧学習履歴の継承対象：${result.reusedLegacyIds.length} 問。` +
        (result.restartedLegacyIds.length ? `形式変更により旧履歴を参照しない問題：${result.restartedLegacyIds.length} 問（${result.restartedLegacyIds.join('、')}）。旧データは削除しない。登録後の学習記録がなければ未学習から開始する。` : '') +
        '登録後に保存した学習記録は保持する。';
      $('preview-explanation').textContent = `解説あり ${s.explained} 問 / 解説なし ${s.total - s.explained} 問`;
      $('preview-sources').replaceChildren(...s.sources.map((source) => element('li', source)));
      const list = $('preview-questions');
      list.replaceChildren();
      draft.questions.forEach((q, index) => {
        const item = element('details', undefined, 'preview-question');
        item.append(element('summary', `${index + 1}. ${q.text}`));
        item.append(element('p', `${q.id} / ${q.questionType} / 重要度 ${q.importance || 'B'}${q.image ? ' / 画像あり' : ''}`, 'muted'));
        if (q.image) { const image = element('img', undefined, 'question-thumb'); image.src = q.image.src; image.alt = q.image.alt; item.append(image, element('p', `画像の説明：${q.image.alt}`, 'muted')); }
        const choices = element('ol');
        q.choices.forEach((choice) => choices.append(element('li', choice)));
        item.append(choices);
        item.append(element('p', q.questionType === '記述' ? `模範解答：${q.answer}` : `正解：${q.choices[q.answer]}`, 'preview-answer'));
        item.append(element('p', q.explanation || '解説なし'));
        item.append(element('p', `出典：${q.source.document} / ${q.source.location}`, 'result-source'));
        list.append(item);
      });
      $('pack-preview').hidden = false;
      $('pack-preview').scrollIntoView({ block: 'start' });
    } catch (error) {
      if (requestRevision === revision) errors([{ path: '問題集', reason: error.message }]);
    } finally { setBusy(false); }
  }
  async function register() {
    if (busy || !draft) return;
    setBusy(true);
    let result;
    try {
      result = await Storage.importPack(draft);
    } catch (e) {
      if (e.validationErrors) errors(e.validationErrors);
      else app.notify(e.message, true);
      return;
    } finally { setBusy(false); }
    // 保存はこの時点で確定。後続の描画失敗を登録失敗として再試行しない。
    const subject = result.pack.subject;
    const wasManual = draftOrigin === 'manual';
    $('pack-input').value = '';
    $('pack-file').value = '';
    $('file-name').textContent = '';
    inputFilename = '';
    inputOrigin = 'file';
    invalidate();
    if (wasManual && typeof QuestionEditor !== 'undefined') QuestionEditor.reset();
    app.notify(`${subject}を ${result.summary.total} 問追加した（出題可能 ${playableCount(result.pack.questions)} 問）。` + (result.reusedLegacyIds.length ? `旧履歴 ${result.reusedLegacyIds.length} 問分を引き継いだ。` : '') + (result.restartedLegacyIds.length ? `形式変更 ${result.restartedLegacyIds.length} 問は旧履歴を参照しない。旧データは保持した。` : ''));
    await app.refreshQuestions();
    await refresh();
    $('manager-back').focus();
    window.scrollTo(0, 0);
  }
  const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif)$/i;
  const shrinkImage = (file) => ImageTools.shrink(file);
  /** JSONの image: { file, alt } を、一緒に選んだ画像ファイルの埋め込みに置き換える。 */
  async function embedImages(text, images) {
    let pack;
    try { pack = JSON.parse(text); } catch (_) { return text; }
    const questions = Array.isArray(pack?.questions) ? pack.questions : [];
    const wanted = questions.filter((q) => q && typeof q.image === 'object' && q.image && typeof q.image.file === 'string');
    if (!wanted.length) return text;
    // ZIP内の「images/heart.png」のようなパスを優先し、なければファイル名だけで照合する。
    const key = (name) => name.replace(/\\/g, '/').replace(/^\.?\//, '').normalize('NFC').toLowerCase();
    const byPath = new Map(images.filter((file) => file.path).map((file) => [key(file.path), file]));
    const byName = new Map(images.map((file) => [key(file.name), file]));
    const missing = [];
    for (const q of wanted) {
      const file = byPath.get(key(q.image.file)) || byName.get(key(q.image.file).split('/').pop());
      if (!file) { missing.push(q.image.file); continue; }
      q.image = { src: await shrinkImage(file), alt: q.image.alt };
    }
    if (missing.length) throw new Error(`問題で使う画像ファイルが見つかりません：${[...new Set(missing)].join('、')}。ZIPに入れるか、JSONと画像ファイルを一緒に選んでください。`);
    const result = JSON.stringify(pack, null, 2);
    const size = new TextEncoder().encode(result).length;
    if (size > QuestionPacks.MAX_BYTES) throw new Error(`画像を含めた問題集が大きすぎます（約${(size / 1048576).toFixed(1)} MiB、上限2 MiB）。画像を減らすか、科目・講義回ごとに分けてください。`);
    return result;
  }
  async function readFile() {
    if (busy) return;
    const files = Array.from($('pack-file').files || []);
    const images = files.filter((f) => IMAGE_FILE.test(f.name));
    const documents = files.filter((f) => !IMAGE_FILE.test(f.name));
    const file = documents[0];
    invalidate();
    $('pack-input').value = '';
    $('file-name').textContent = '';
    inputFilename = '';
    inputOrigin = 'file';
    if (!files.length) return;
    if (documents.length !== 1) { errors([{ path: 'ファイル', reason: '問題集のファイルを1つ選んでください。画像を使う問題集は、JSONと画像ファイルを一緒に選べます。' }]); return; }
    const requestRevision = revision;
    setBusy(true);
    try {
      // 問題集パック（.zip）：JSONと画像をまとめた1ファイル。
      const result = /\.zip$/i.test(file.name) ? await DocumentReader.readPack(file) : await DocumentReader.read(file);
      if (requestRevision !== revision) return;
      const text = result.images || /\.json$/i.test(file.name) ? await embedImages(result.text, images.concat(result.images || [])) : result.text;
      if (requestRevision !== revision) return;
      $('pack-input').value = text;
      inputFilename = result.filename;
      const imageCount = images.length + (result.images?.length || 0);
      $('file-name').textContent = `選択したファイル：${file.name}` + (imageCount ? `（画像 ${imageCount} 枚）` : '');
    } catch (error) {
      if (requestRevision === revision) errors([{ path: 'ファイル', reason: error.message }]);
      return;
    } finally { setBusy(false); }
    await preview();
  }
  async function requestDelete(subject) {
    const imported = await Storage.getImportedQuestions();
    const targets = imported.filter((q) => q.subject === subject);
    if (!targets.length) throw new Error('削除できる追加問題は0問');
    const builtIn = app.builtIns.some((q) => q.subject === subject);
    deleteTarget = { subject, ids: targets.map((q) => q.id) };
    $('delete-title').textContent = builtIn ? '追加分だけを削除' : '科目の削除';
    $('delete-description').textContent = `${subject}の登録問題 ${targets.length} 問を削除する。` +
      (builtIn ? '組込問題とその履歴は残す。' : '') +
      '履歴の削除を選ぶ場合、以前この科目で保持した問題の履歴と、同じ問題IDに対応する旧組込問題の履歴も対象になる。他科目の履歴は残す。';
    $('delete-history').checked = false;
    $('delete-error').textContent = '';
    $('delete-dialog').showModal();
  }
  async function confirmDelete() {
    if (!deleteTarget || busy) return;
    busy = true;
    $('confirm-delete').disabled = true;
    $('cancel-delete').disabled = true;
    $('delete-history').disabled = true;
    const target = deleteTarget;
    const history = $('delete-history').checked;
    let count;
    try { count = await Storage.deleteImportedSubject(target.subject, history, target.ids); }
    catch (e) { $('delete-error').textContent = e.message; return; }
    finally {
      busy = false;
      $('confirm-delete').disabled = false;
      $('cancel-delete').disabled = false;
      $('delete-history').disabled = false;
    }
    $('delete-dialog').close();
    deleteTarget = null;
    invalidate();
    app.notify(`${target.subject}の登録問題 ${count} 問を削除した。` + (history ? 'この科目の対象履歴も削除した。' : '学習履歴は残している。'));
    await app.refreshQuestions();
    await refresh();
  }
  async function open() { await refresh(); app.showScreen('manager'); }

  // ---- QRコードでの共有 ----
  let share = null;
  async function openShare(subject) {
    const imported = await Storage.getImportedQuestions();
    const questions = imported.filter((q) => q.subject === subject);
    const usable = questions.filter(QuestionShare.shareable);
    if (!usable.length) throw new Error('共有できる問題がありません（画像つきの問題は、ZIPの書き出しで渡してください）。');
    share = { subject, questions: usable, selected: new Set(usable.map((q) => q.id)), links: [], page: 0 };
    const skipped = questions.length - usable.length;
    $('share-subject').textContent = `${subject}：${usable.length} 問` + (skipped ? `（画像つきの ${skipped} 問は共有できません）` : '');
    $('share-list').replaceChildren(...usable.map((q) => {
      const box = element('input'); box.type = 'checkbox'; box.checked = true; box.dataset.id = q.id;
      box.addEventListener('change', () => { box.checked ? share.selected.add(q.id) : share.selected.delete(q.id); renderShare(); });
      const label = element('label'); label.append(box, element('span', q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text));
      const item = element('li'); item.append(label); return item;
    }));
    $('share-pick').open = false;
    renderShare();
    $('share-dialog').showModal();
  }
  function selectAllShare(value) {
    if (!share) return;
    share.selected = new Set(value ? share.questions.map((q) => q.id) : []);
    $('share-list').querySelectorAll('input[type=checkbox]').forEach((box) => { box.checked = value; });
    renderShare();
  }
  function renderShare() {
    if (!share) return;
    const chosen = share.questions.filter((q) => share.selected.has(q.id));
    $('share-pick-summary').textContent = `共有する問題を選ぶ（${chosen.length} / ${share.questions.length} 問）`;
    share.links = []; share.page = 0;
    if (!chosen.length) {
      $('share-size').textContent = '共有する問題を1問以上選んでください。';
      $('share-code').hidden = true; $('share-nav').hidden = true; return;
    }
    const result = QuestionShare.encode(QuestionShare.packFor(share.subject, chosen, $('share-explanation').checked));
    if (!result.fits) {
      $('share-size').textContent = `${chosen.length} 問だとQRコードが ${result.parts} 枚になり、多すぎます（${QuestionShare.MAX_PARTS} 枚まで）。問題を減らすか、解説を外すか、「問題を書き出す」でファイルを渡してください。`;
      $('share-code').hidden = true; $('share-nav').hidden = true; return;
    }
    share.links = result.links;
    $('share-size').textContent = result.parts === 1 ? `${chosen.length} 問をQRコード1枚にまとめました。` : `${chosen.length} 問をQRコード ${result.parts} 枚に分けました。すべて読み取ってもらってください（順番は問いません）。`;
    showSharePage();
  }
  function showSharePage() {
    const total = share.links.length;
    const svg = QuestionShare.qrSvg(share.links[share.page]);
    svg.setAttribute('aria-label', `共有用のQRコード ${share.page + 1} / ${total}`);
    $('share-qr').replaceChildren(svg);
    $('share-page').textContent = total > 1 ? `${share.page + 1} / ${total} 枚目` : '';
    $('share-code').hidden = false; $('share-nav').hidden = false;
    $('share-prev').hidden = $('share-next').hidden = total === 1;
    $('share-prev').disabled = share.page === 0;
    $('share-next').disabled = share.page === total - 1;
  }
  async function copyShareLink() {
    if (!share?.links.length) return;
    const all = share.links.join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('コピーAPIなし');
      await navigator.clipboard.writeText(all);
      app.notify(share.links.length > 1 ? `共有リンク ${share.links.length} 本をまとめてコピーしました。` : '共有リンクをコピーしました。');
    } catch (_) { app.notify('コピーできませんでした。QRコードを読み取ってもらってください。', true); }
  }

  // ---- 共有された問題の受け取り ----
  const received = {};
  /** リンクを集め、そろったら「登録前の確認」へ。自動では登録しない。 */
  async function receive(text) {
    const links = QuestionShare.findLinks(text);
    if (!links.length) throw new Error('共有リンクが見つかりません。「' + QuestionShare.BASE + '#share=…」で始まるリンクを貼り付けてください。');
    const result = QuestionShare.collect(links, received);
    await open();
    $('share-receive').open = true;
    if (!result.done) {
      $('share-status').textContent = `QRコード ${result.total} 枚のうち ${result.have} 枚を読み取りました。残り：${result.missing.join('・')} 枚目。`;
      $('share-receive').scrollIntoView?.({ block: 'start' });
      return;
    }
    $('share-status').textContent = '共有された問題を読み取りました。下の内容を確認してから登録してください。';
    $('share-input').value = '';
    invalidate();
    $('pack-input').value = result.text;
    $('pack-file').value = ''; $('file-name').textContent = '共有された問題';
    inputFilename = ''; inputOrigin = 'shared';
    await preview();
  }
  /** Web版：QRコードから開かれたときに、リンクの「#share=…」を受け取る。 */
  async function receiveFromLocation() {
    if (!QuestionShare.parseLink(location.hash)) return;
    const text = location.hash;
    // 読み取った内容はアドレス欄・履歴に残さない。
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { location.hash = ''; }
    await receive(text);
  }
  async function help() {
    const imported = await Storage.getImportedQuestions();
    const all = app.builtIns.concat(imported);
    const context = '\n\n【現在登録されている科目】\n' + [...new Set(all.map((q) => q.subject))].join('\n') +
      '\n\n【使用済み問題ID：新規問題に再利用しない】\n' + all.map((q) => q.id).join(', ');
    $('pack-format').textContent = PackHelp.format;
    $('pack-sample').textContent = JSON.stringify(PackHelp.sample, null, 2);
    $('creation-prompt').value = PackHelp.prompt + (window.studyDesktop ? '' : '\n\n今回はブラウザ版で使うため、選択肢・正誤問題だけを作成してください。記述問題は含めません。') + context;
    $('full-question-rules').textContent = PackHelp.rules;
    $('source-errata-text').textContent = PackHelp.errata;
    $('review-decisions-text').textContent = PackHelp.decisions;
    $('help-origin').textContent = '同梱文書から生成した指示文。現在登録済みの科目名と問題IDを末尾に付けている。';
    app.showScreen('pack-help');
  }
  async function copyPrompt() {
    const input = $('creation-prompt');
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('コピーAPIなし');
      await navigator.clipboard.writeText(input.value);
      app.notify('問題作成用の指示文をコピーした。');
    } catch (_) {
      input.focus(); input.select();
      app.notify('自動コピーが使えないため指示文を選択した。Ctrl+C（MacはCommand+C）でコピーできる。');
    }
  }
  function initialize(api) {
    app = api;
    const template = $('text-template');
    const writtenTemplate = $('text-template-written');
    if (window.studyDesktop && template && writtenTemplate && !template.dataset.writtenIncluded) {
      template.textContent += '\n\n' + writtenTemplate.textContent;
      template.dataset.writtenIncluded = 'true';
    }
    const on = (id, action, event = 'click') => $(id).addEventListener(event, app.safeAction(action));
    on('open-manager', open);
    on('empty-add-subject', open);
    on('manager-back', app.renderStart);
    on('pack-help-back', open);
    on('open-pack-help', help);
    on('validate-pack', preview);
    on('register-pack', register);
    on('cancel-pack', invalidate);
    on('pack-input', () => { $('file-name').textContent = ''; inputFilename = ''; inputOrigin = 'file'; invalidate(); }, 'input');
    on('pack-file', readFile, 'change');
    on('cancel-delete', () => { if (!busy) { $('delete-dialog').close(); deleteTarget = null; } });
    on('confirm-delete', confirmDelete);
    $('delete-dialog').addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
    on('copy-creation-prompt', copyPrompt);
    if (typeof QuestionShare !== 'undefined' && $('share-dialog')) {
      on('share-close', () => { $('share-dialog').close(); share = null; });
      on('share-prev', () => { if (share && share.page > 0) { share.page--; showSharePage(); } });
      on('share-next', () => { if (share && share.page < share.links.length - 1) { share.page++; showSharePage(); } });
      on('share-copy', copyShareLink);
      on('share-all', () => selectAllShare(true));
      on('share-none', () => selectAllShare(false));
      on('share-explanation', renderShare, 'change');
      on('share-read', () => receive($('share-input').value));
      window.addEventListener?.('hashchange', app.safeAction(receiveFromLocation));
    }
    on('use-pack-sample', async () => {
      $('pack-input').value = JSON.stringify(PackHelp.sample, null, 2);
      $('file-name').textContent = '';
      inputFilename = ''; inputOrigin = 'file';
      invalidate(); await open(); $('paste-pack').open = true; $('pack-input').focus();
    });
    if ($('download-text-template')) on('download-text-template', () => {
      const blob = new Blob([$('text-template').textContent + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = element('a'); anchor.href = url; anchor.download = '問題集の見本.txt';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
    if (typeof QuestionEditor !== 'undefined') QuestionEditor.initialize({
      onChange() {
        invalidate();
        if (inputOrigin === 'manual') { $('pack-input').value = ''; inputOrigin = 'file'; }
      },
      async onPreview(pack) {
        if (busy) throw new Error('処理が終わってから、もう一度確認してください。');
        invalidate();
        $('pack-input').value = JSON.stringify(pack, null, 2);
        $('pack-file').value = ''; $('file-name').textContent = '';
        inputFilename = ''; inputOrigin = 'manual';
        await preview();
        if (draft) $('manual-create').open = false;
      },
    });
  }
  /** AIで作った問題セットを、手作りと同じ「登録前の確認」に通す。自動では登録しない。 */
  async function previewGenerated(pack, filename) {
    if (busy) throw new Error('処理が終わってから、もう一度お試しください。');
    invalidate();
    $('pack-input').value = JSON.stringify(pack, null, 2);
    $('pack-file').value = ''; $('file-name').textContent = '';
    inputFilename = filename || ''; inputOrigin = 'generated';
    await preview();
    if (draft) $('pack-preview').scrollIntoView?.({ block: 'start' });
  }
  return { initialize, open, refresh, previewGenerated, receiveFromLocation };
})();
