/** 暗記カード。問題・学習履歴とは別の保存領域（quiz-app.cards.v1）に保存し、既存データの形式は変えない。 */
const Flashcards = (() => {
  'use strict';
  const KEY = 'quiz-app.cards.v1';
  // 箱（覚えた度合い）1〜6ごとの次の復習までの日数。「まだ」で箱1（すぐ復習）に戻る。
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const SESSION = 30;
  let app = {};
  let session = null;
  let draft = null;
  let source = null;
  const $ = (id) => document.getElementById(id);
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const newId = () => 'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function load() {
    let raw;
    try { raw = window.localStorage.getItem(KEY); } catch (_) { throw new Error('保存領域にアクセスできません。'); }
    if (raw === null) return { version: 1, decks: [] };
    let value;
    try { value = JSON.parse(raw); } catch (_) { value = null; }
    // 壊れたデータは上書きせずに止める（自動で初期化しない）。
    if (!validData(value)) throw new Error('暗記カードの保存データを読み取れません。データは削除していません。');
    return value;
  }
  function validData(value) {
    const text = v => typeof v === 'string' && v.trim().length > 0;
    const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
    if (!value || value.version !== 1 || !Array.isArray(value.decks)) return false;
    const deckIds = new Set(), cardIds = new Set();
    for (const deck of value.decks) {
      if (!deck || !text(deck.id) || deckIds.has(deck.id) || !text(deck.name) || !date(deck.createdAt) || !Array.isArray(deck.cards)) return false;
      deckIds.add(deck.id);
      for (const card of deck.cards) {
        if (!card || !text(card.id) || cardIds.has(card.id) || !text(card.front) || !text(card.back) || !Number.isInteger(card.box) || card.box < 1 || card.box > INTERVALS.length || !(card.due === null || date(card.due)) || (card.location !== undefined && typeof card.location !== 'string')) return false;
        cardIds.add(card.id);
      }
    }
    return true;
  }
  function save(data) {
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (_) { throw new Error('保存できませんでした。保存容量を確認してください。'); }
  }
  const isDue = (card, now) => !card.due || new Date(card.due) <= now;
  function addCards(deckName, cards) {
    const data = load();
    let deck = data.decks.find((d) => d.name === deckName);
    if (!deck) { deck = { id: newId(), name: deckName, createdAt: new Date().toISOString(), cards: [] }; data.decks.push(deck); }
    const fronts = new Set(deck.cards.map((c) => c.front));
    let added = 0;
    for (const c of cards) {
      if (!c.front || !c.back || fronts.has(c.front)) continue;
      fronts.add(c.front);
      deck.cards.push({ id: newId(), front: c.front, back: c.back, ...(c.location ? { location: c.location } : {}), box: 1, due: null });
      added++;
    }
    save(data);
    return { added, skipped: cards.length - added };
  }

  function renderDecks() {
    const list = $('cards-decks');
    let data;
    try { data = load(); } catch (error) { list.replaceChildren(element('p', error.message, 'error-list')); return; }
    const now = new Date();
    list.replaceChildren(...(data.decks.length ? data.decks.map((deck) => {
      const due = deck.cards.filter((c) => isDue(c, now)).length;
      const item = element('div', undefined, 'panel card-deck');
      item.append(element('strong', deck.name), element('p', `${deck.cards.length} 枚・今日の復習 ${due} 枚`, 'muted'));
      const actions = element('div', undefined, 'actions');
      const study = element('button', due ? `学習する（${Math.min(due, SESSION)} 枚）` : 'すべて復習する', 'primary');
      study.type = 'button';
      study.addEventListener('click', app.safeAction(() => startStudy(deck.id, !due)));
      const remove = element('button', '削除', 'danger');
      remove.type = 'button';
      remove.addEventListener('click', app.safeAction(() => {
        if (!window.confirm(`「${deck.name}」の ${deck.cards.length} 枚を削除しますか？元に戻せません。`)) return;
        const current = load();
        current.decks = current.decks.filter((d) => d.id !== deck.id);
        save(current); renderDecks();
      }));
      actions.append(study, remove);
      item.append(actions);
      return item;
    }) : [element('p', 'まだカードがありません。下の「自分でカードを追加」や、PC版の「AIでカードを作る」から作れます。', 'muted')]));
  }
  function open() {
    $('cards-study').hidden = true;
    $('cards-home').hidden = false;
    renderDecks();
    renderControls();
    app.showScreen('cards');
  }

  function startStudy(deckId, all) {
    const deck = load().decks.find((d) => d.id === deckId);
    if (!deck || !deck.cards.length) return;
    const now = new Date();
    const cards = deck.cards.filter((c) => all || isDue(c, now)).sort(() => Math.random() - 0.5).slice(0, SESSION);
    session = { deckId, ids: cards.map((c) => c.id), index: 0, known: 0 };
    $('cards-home').hidden = true;
    $('cards-study').hidden = false;
    showCard();
  }
  function current() {
    const deck = load().decks.find((d) => d.id === session?.deckId);
    return deck && deck.cards.find((c) => c.id === session.ids[session.index]);
  }
  function showCard() {
    const card = current();
    if (!card) { finish(); return; }
    $('cards-progress').textContent = `${session.index + 1} / ${session.ids.length} 枚`;
    $('cards-front').textContent = card.front;
    $('cards-back').textContent = card.back + (card.location ? `\n（${card.location}）` : '');
    $('cards-back').hidden = true;
    $('cards-reveal').hidden = false;
    $('cards-grade').hidden = true;
    $('cards-reveal').focus?.();
  }
  function reveal() {
    if (!session) return;
    $('cards-back').hidden = false;
    $('cards-reveal').hidden = true;
    $('cards-grade').hidden = false;
  }
  function grade(known) {
    // 連打などで学習が終わった後に押されても何もしない。
    if (!session || $('cards-grade').hidden) return;
    const data = load();
    const deck = data.decks.find((d) => d.id === session?.deckId);
    const card = deck && deck.cards.find((c) => c.id === session.ids[session.index]);
    if (card) {
      card.box = known ? Math.min(INTERVALS.length, (card.box || 1) + 1) : 1;
      card.due = new Date(Date.now() + INTERVALS[card.box - 1] * 86400000).toISOString();
      card.reviewedAt = new Date().toISOString();
      save(data);
    }
    if (known) session.known++;
    session.index++;
    if (session.index >= session.ids.length) finish(); else showCard();
  }
  function finish() {
    const done = session ? session.index : 0;
    const known = session ? session.known : 0;
    session = null;
    open();
    if (done) app.notify(`暗記カード ${done} 枚を復習しました（覚えた ${known} 枚）。`);
  }

  function addManual() {
    const deck = $('cards-manual-deck').value.trim(), front = $('cards-manual-front').value.trim(), back = $('cards-manual-back').value.trim();
    const status = $('cards-manual-status');
    if (!deck || !front || !back) { status.textContent = '束の名前・表・裏をすべて入力してください。'; return; }
    const result = addCards(deck, [{ front, back }]);
    status.textContent = result.added ? `「${deck}」に追加しました。` : '同じ表のカードがすでにあります。';
    $('cards-manual-front').value = ''; $('cards-manual-back').value = '';
    $('cards-manual-front').focus?.();
    renderDecks();
  }

  /** AIでカードを作る（PC版・AIモード）。保存前に一覧で確認し、不要なカードを外せる。 */
  function renderControls() {
    const panel = $('cards-ai');
    if (!panel) return;
    panel.hidden = !app.desktop();
    $('cards-ai-start').disabled = !source || app.busy();
    $('cards-ai-cancel').hidden = !app.running('cards');
    $('cards-ai-provider').textContent = `使うAI：${app.providerName()}（開始画面の「採点AI」で切り替え）`;
  }
  async function chooseSource() {
    const input = $('cards-ai-file');
    const info = $('cards-ai-file-info');
    source = null; info.textContent = '';
    const file = input.files?.[0];
    if (file) {
      try {
        source = await DocumentReader.readForGeneration(file);
        if (!$('cards-ai-deck').value.trim()) $('cards-ai-deck').value = source.filename.replace(/\.docx$/i, '').slice(0, 200);
        info.textContent = `本文 ${source.text.length.toLocaleString()} 文字・赤文字 ${source.red} か所` + (source.red ? '' : '。赤文字がないため、用語と定義から作ります');
      } catch (error) { input.value = ''; info.textContent = error.message || 'Wordファイルを読み取れません。'; }
    }
    renderControls();
  }
  async function generate() {
    const status = $('cards-ai-status');
    if (!source) return;
    const deck = $('cards-ai-deck').value.trim();
    if (!deck) { status.textContent = '束の名前を入力してください。'; return; }
    if (!app.providerReady()) { status.textContent = app.notReadyMessage(); return; }
    const run = app.begin('cards');
    if (!run) return;
    status.textContent = '資料からカードを作っています。数分かかることがあります…';
    $('cards-ai-preview').hidden = true;
    try {
      const result = await window.studyDesktop.makeCards({ provider: app.provider(), deck, document: source.filename, text: source.text, count: Number($('cards-ai-count').value) });
      if (!app.current(run)) return;
      draft = { deck, cards: result.cards };
      renderDraft();
      status.textContent = `${result.cards.length} 枚を作りました。不要なカードのチェックを外してから保存してください。` + (result.notes ? `\nAIからの補足：${result.notes}` : '');
    } catch (error) {
      if (app.current(run)) status.textContent = error.message || 'カードを作れませんでした。';
    } finally { app.end(run); renderControls(); }
  }
  function renderDraft() {
    const list = $('cards-ai-list');
    list.replaceChildren(...draft.cards.map((card, i) => {
      const row = element('label', undefined, 'card-draft');
      const box = element('input'); box.type = 'checkbox'; box.checked = true; box.dataset.index = String(i);
      row.append(box, element('span', `表：${card.front}　／　裏：${card.back}`));
      return row;
    }));
    $('cards-ai-preview').hidden = false;
  }
  function saveDraft() {
    if (!draft) return;
    const keep = Array.from(document.querySelectorAll('#cards-ai-list input[type="checkbox"]')).filter((b) => b.checked).map((b) => draft.cards[Number(b.dataset.index)]);
    if (!keep.length) { $('cards-ai-status').textContent = '保存するカードを1枚以上選んでください。'; return; }
    const result = addCards(draft.deck, keep);
    $('cards-ai-status').textContent = `「${draft.deck}」に ${result.added} 枚を保存しました。` + (result.skipped ? `（同じ表のカード ${result.skipped} 枚は追加していません）` : '');
    draft = null;
    $('cards-ai-preview').hidden = true;
    renderDecks();
  }

  function initialize(options) {
    app = options;
    const on = (id, action, event = 'click') => $(id)?.addEventListener(event, app.safeAction(action));
    on('open-cards', open);
    on('cards-back-start', app.renderStart);
    on('cards-reveal', reveal);
    on('cards-known', () => grade(true));
    on('cards-unknown', () => grade(false));
    on('cards-quit', finish);
    on('cards-manual-add', addManual);
    on('cards-ai-file', chooseSource, 'change');
    on('cards-ai-start', generate);
    on('cards-ai-cancel', app.cancel);
    on('cards-ai-save', saveDraft);
  }
  return { initialize, renderControls, _test: { load, addCards, INTERVALS } };
})();
