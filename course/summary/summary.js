/**
 * 問題のまとめ（course/summary/）。合言葉の入力・復号・検査は学習アプリと同じ入口（../questions.js）が行い、
 * ここでは検査済みの問題（QUESTIONS）を科目・講義回ごとに一覧にする。表示は textContent だけ。
 */
(() => {
  'use strict';
  const HIDE_STORE = 'course-app.summary-hide.v1';
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };

  // ---- 一覧の表示 ----
  const lectureOf = (q) => QuestionPacks.lecture(q) || 0;
  const groupKey = (q) => `${q.subject}\u0000${lectureOf(q)}`;
  function card(q, index) {
    const item = el('article', undefined, 'card');
    item.dataset.group = groupKey(q);
    const location = typeof q.source.location === 'string' ? q.source.location : `${q.source.location}ページ`;
    item.append(el('p', `問${index} ・ ${q.questionType} ・ ${location}`, 'meta'));
    item.append(el('p', q.text, 'text'));
    if (q.image) { const image = el('img'); image.src = q.image.src; image.alt = q.image.alt; item.append(image); }
    if (q.questionType === '選択肢' || q.questionType === '想起' || q.questionType === QuestionPacks.MULTI) {
      const list = el('ol');
      q.choices.forEach((choice, i) => {
        const li = el('li', choice);
        if (QuestionPacks.correctIndexes(q).includes(i)) { li.classList.add('is-correct'); li.append(el('span', '（正解）', 'is-correct-mark')); }
        list.append(li);
      });
      item.append(list);
    }
    const answer = q.questionType === '記述' ? `模範解答：${q.answer}` : `正解：${QuestionPacks.answerText(q)}`;
    const area = el('div', undefined, 'answer-area');
    area.append(el('span', answer, 'answer'));
    if (q.explanation) area.append(el('p', q.explanation, 'explanation'));
    item.append(area);
    const reveal = el('button', '答えを見る', 'reveal');
    reveal.type = 'button';
    reveal.addEventListener('click', () => item.classList.add('revealed'));
    item.append(reveal);
    item.dataset.search = [q.text, ...(q.choices || []), typeof q.answer === 'string' ? q.answer : '', q.explanation || '', location].join('\n').toLowerCase();
    return item;
  }
  function render({ questions, updatedAt }) {
    const list = $('list');
    const subjects = [...new Set(questions.map((q) => q.subject))];
    const filter = $('lecture-filter');
    filter.replaceChildren(el('option', 'すべての回'));
    filter.firstChild.value = '';
    const toc = el('ul', undefined, 'toc no-print');
    for (const subject of subjects) {
      const inSubject = questions.filter((q) => q.subject === subject);
      const lectures = [...new Set(inSubject.map(lectureOf))].sort((a, b) => (a || Infinity) - (b || Infinity));
      const heading = el('h2', `${subject}（${inSubject.length}問）`);
      list.append(heading);
      for (const lecture of lectures) {
        const group = inSubject.filter((q) => lectureOf(q) === lecture);
        const section = el('section');
        section.dataset.group = groupKey(group[0]);
        section.id = `s-${subjects.indexOf(subject)}-${lecture}`;
        section.append(el('h3', `${QuestionPacks.lectureLabel(lecture)}（${group.length}問）`));
        group.forEach((q, i) => section.append(card(q, i + 1)));
        list.append(section);
        const option = el('option', `${subject} ${QuestionPacks.lectureLabel(lecture)}`);
        option.value = section.dataset.group;
        filter.append(option);
        const link = el('a', `${subjects.length > 1 ? subject + ' ' : ''}${QuestionPacks.lectureLabel(lecture)}`);
        link.href = `#${section.id}`;
        const li = el('li'); li.append(link); toc.append(li);
      }
    }
    list.prepend(toc);
    $('summary-count').textContent = `全${questions.length}問`;
    if (updatedAt) $('summary-updated').textContent = `（${updatedAt} 更新）`;
    const apply = () => {
      const words = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const group = filter.value;
      let shown = 0;
      list.querySelectorAll('section').forEach((section) => {
        let visible = 0;
        section.querySelectorAll('.card').forEach((item) => {
          const ok = (!group || item.dataset.group === group) && words.every((w) => item.dataset.search.includes(w));
          item.hidden = !ok; if (ok) visible++;
        });
        section.hidden = !visible; shown += visible;
      });
      list.querySelectorAll('h2').forEach((h) => {
        let next = h.nextElementSibling, any = false;
        while (next && next.tagName === 'SECTION') { if (!next.hidden) any = true; next = next.nextElementSibling; }
        h.hidden = !any;
      });
      $('no-match').hidden = shown > 0;
    };
    $('search').addEventListener('input', apply);
    filter.addEventListener('change', apply);
    const hide = $('hide-answers');
    try { hide.checked = window.localStorage.getItem(HIDE_STORE) === '1'; } catch (_) { /* 既定は表示 */ }
    const applyHide = () => {
      list.classList.toggle('hidden-answers', hide.checked);
      list.querySelectorAll('.card.revealed').forEach((item) => item.classList.remove('revealed'));
      try { window.localStorage.setItem(HIDE_STORE, hide.checked ? '1' : '0'); } catch (_) { /* この画面の間だけ */ }
    };
    hide.addEventListener('change', applyHide);
    applyHide();
    $('print').addEventListener('click', () => window.print());
    $('content').hidden = false;
  }

  // 合言葉の入力・復号・検査は学習アプリと同じ入口（../questions.js）が行う。
  window.studyBuiltInsReady.then(() => {
    const info = window.studyCourseInfo || {};
    const guest = info.guestUntil ? ` ゲスト（${new Date(info.guestUntil).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' })}まで）` : '';
    render({ questions: QUESTIONS, updatedAt: info.updatedAt || '' });
    if (guest) $('summary-updated').textContent += guest;
  });
})();
