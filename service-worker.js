// 前のURL（GitHub Pages）の版の入れ替え。保存されている前の版のアプリをすぐに止め、「移りました」画面を出す。
// 学習記録（localStorage）には触れない。消すのはアプリのファイルの保存（Cache Storage）だけ。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
  })());
});
