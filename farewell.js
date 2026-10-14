/**
 * 前のURL（GitHub Pages）の「移りました」画面。この端末の学習記録を集め、新しいURLの引き継ぎ画面へ渡す。
 * 記録はURLの「#data=」以降に入れる（サーバーへは送られない）。長すぎるときはファイルに保存して渡す。
 */
(() => {
  'use strict';
  const NEW = 'https://lecture-study.pages.dev/';
  const $ = (id) => document.getElementById(id);
  // QR共有のリンク（#share=…）は、そのまま新しいURLへ。
  if (/^#share=/.test(window.location.hash)) { window.location.replace(NEW + window.location.hash); return; }
  // 問題入りの学習アプリ（course/）から来たときは、新しいURLの問題入りの学習アプリへ。
  const course = /\/course\//.test(window.location.pathname);
  if (course) { $('new-url').href = NEW + 'course/'; $('new-url').textContent = NEW + 'course/'; $('go').href = NEW + 'course/'; }
  let data;
  try { data = StudyTransfer.collect(window.localStorage); } catch (_) { data = { v: 1, items: {} }; }
  const keys = Object.keys(data.items);
  if (!keys.length) { $('no-data').hidden = false; return; }
  const s = StudyTransfer.summary(data.items);
  $('summary').textContent = `登録した問題 ${s.subjects}科目・${s.questions}問、回答の記録 ${s.answers}回（設定などを含めて ${s.keys}件）`;
  $('has-data').hidden = false;
  $('move').addEventListener('click', () => {
    try {
      const packed = StudyTransfer.pack(StudyTransfer.collect(window.localStorage));
      if (packed.length > StudyTransfer.URL_LIMIT) throw new Error('記録が多いため、この方法では移せません。「ファイルに保存」を使ってください。');
      window.location.href = `${NEW}move/#data=${packed}`;
    } catch (e) { $('error').textContent = e.message; $('error').hidden = false; }
  });
  $('save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(StudyTransfer.collect(window.localStorage))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `学習アプリ_引き継ぎ_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
})();
