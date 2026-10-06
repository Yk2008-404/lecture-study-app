'use strict';

// The distribution builder replaces this version with a digest of the app files.
// If distributing these source files directly, change it after every app update.
const CACHE_VERSION = '29a586af055ef528';
const CACHE_PREFIX = `study-app-offline:${self.registration.scope}:`;
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const RUNTIME_FILES = [
  'index.html',
  'theme.js',
  'questions.js',
  'question-packs.js',
  'legacy-identities.js',
  'storage.js',
  'scheduler.js',
  'pack-help.js',
  'subject-manager.js',
  'app.js',
  'install-support.js',
  'manifest.webmanifest',
  'icons/app-icon.svg',
  'icons/app-icon-192.png',
  'icons/app-icon-512.png',
  'icons/apple-touch-icon.png',
];
const RUNTIME_URLS = RUNTIME_FILES.map((file) => new URL(file, self.registration.scope).href);
const ALLOWED_URLS = new Set(RUNTIME_URLS);
const INDEX_URL = new URL('index.html', self.registration.scope).href;
const START_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Nothing is written until every required response succeeds. Old caches are
    // kept intact if the network or a new release is incomplete.
    const responses = await Promise.all(RUNTIME_URLS.map(async (url) => {
      // Static hosts may redirect index.html to the directory URL. Fetch that
      // canonical page directly, while retaining one cache key for navigation.
      const fetchURL = url === INDEX_URL ? START_URL : url;
      const response = await fetch(new Request(fetchURL, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok || response.type === 'opaque' || response.redirected) {
        throw new Error('App file could not be saved for offline use.');
      }
      return response;
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(RUNTIME_URLS.map((url, index) => cache.put(url, responses[index])));
    // Do not skipWaiting: an update must not replace the active quiz mid-session.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const complete = (await Promise.all(RUNTIME_URLS.map((url) => cache.match(url)))).every(Boolean);
    if (!complete) throw new Error('Offline app cache is incomplete.');
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    // Existing pages finish with their current code; the next opening uses this worker.
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  const cleanURL = url.href;
  const navigation = event.request.mode === 'navigate' && (cleanURL === START_URL || cleanURL === INDEX_URL);
  if (!navigation && !ALLOWED_URLS.has(cleanURL)) return;
  const cacheURL = navigation ? INDEX_URL : cleanURL;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(cacheURL);
    if (saved) return saved;
    // Only app files from the whitelist are handled or cached. Imported questions
    // and learning records remain in localStorage and are never sent by this worker.
    return fetch(event.request);
  })());
});
