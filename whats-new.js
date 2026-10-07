/** 更新内容（リリースノート）。更新後の初回起動で、前回見た版より新しい分だけを表示する。 */
const WhatsNew = (() => {
  'use strict';
  // 新しい版を上に追加する。version はPC版の版番号（内容の更新を含む）。Web版は先頭の版として扱う。
  const NOTES = [
    {
      version: '1.2.0', date: '2026-10-07',
      items: [
        ['QRコードで問題を共有', '「科目を管理」の各科目の「QRコードで共有」から。相手がスマホのカメラで読み取ると、確認のあとで取り込めます。PC版はリンクを「共有された問題を取り込む」に貼り付けます。'],
        ['出題する形式', '開始画面で「選択問題だけ」「正誤だけ」「記述だけ（PC版）」に絞って出題できます。'],
        ['間違えた問題だけ復習・学習の分析', '開始画面から、最後に間違えた問題だけを解き直せます。苦手な分野も確認できます。'],
        ['暗記カード', '開始画面の「暗記カード」。覚えたカードは1・3・7・14・30日後にもう一度出ます。'],
        ['画像つきの問題', '「自分で問題を作る」で画像を貼り付けられます。JSONと画像をまとめたZIPもそのまま取り込めます。'],
        ['AIの新機能（PC版）', 'Wordの講義資料から問題集・暗記カードを作る、レポートチェック、「なぜ間違えた？」の解説、CodexとClaudeのダブルチェック、使用量の表示。使わないときは「AIモード」をオフにできます。'],
        ['アプリ内アップデート（PC版）', 'これからの更新は、開始画面の案内で「更新する」を押すだけで受け取れます。'],
      ],
    },
  ];
  const KEY = 'quiz-app.seen-notes.v1';

  const parse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(v || '')); return m && [+m[1], +m[2], +m[3], m[4] ? +m[4] : Infinity]; };
  function compare(a, b) {
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  function seen() { try { const v = window.localStorage.getItem(KEY); return parse(v) ? v : null; } catch (_) { return null; } }
  function remember(version) { try { window.localStorage.setItem(KEY, version); } catch (_) { /* 次回もう一度表示されるだけ */ } }

  /**
   * 表示する更新内容を決める。
   * current: 動いている版（Web版は null → 最新の更新内容の版）。returning: 以前から使っている人か（問題・記録がある）。
   * 初めて使う人には表示せず、今の版を見たことにする。
   */
  function pending(current, returning) {
    const version = parse(current) ? current : NOTES[0].version;
    const last = seen();
    const upTo = NOTES.filter((n) => compare(n.version, version) <= 0);
    if (!last) {
      if (!returning) { remember(version); return []; }
      return upTo.slice(0, 1);
    }
    if (compare(last, version) >= 0) return [];
    return upTo.filter((n) => compare(n.version, last) > 0);
  }

  let shownVersion = null;
  function render(notes) {
    const list = document.getElementById('whats-new-list');
    list.replaceChildren();
    for (const note of notes) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = `バージョン ${note.version}（${note.date}）`;
      const items = document.createElement('ul');
      for (const [title, text] of note.items) {
        const item = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = title;
        item.append(strong, document.createTextNode('：' + text));
        items.append(item);
      }
      section.append(heading, items);
      list.append(section);
    }
  }
  function open(notes, version) {
    const dialog = document.getElementById('whats-new');
    if (!dialog || !notes.length) return false;
    shownVersion = version;
    document.getElementById('whats-new-title').textContent = notes.length > 1 ? '更新内容' : `バージョン ${notes[0].version} の新機能`;
    render(notes);
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return true;
  }
  /** 起動時に呼ぶ。更新後の初回なら表示する。 */
  function showIfUpdated(current, returning) {
    const version = parse(current) ? current : NOTES[0].version;
    return open(pending(current, returning), version);
  }
  /** 画面下の「更新内容」から、いつでも見られる。 */
  function showAll() { return open(NOTES.slice(0, 3), null); }
  function close() {
    if (shownVersion) remember(shownVersion);
    shownVersion = null;
    document.getElementById('whats-new')?.close?.();
  }
  return { NOTES, pending, showIfUpdated, showAll, close, _test: { compare, KEY } };
})();
