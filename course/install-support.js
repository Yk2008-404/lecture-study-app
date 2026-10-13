/** Optional status element: <p id="offline-status" class="muted"></p>. */
(() => {
  'use strict';
  const status = (message) => {
    const element = document.getElementById('offline-status');
    if (element) element.textContent = message;
  };
  if (location.protocol === 'file:') {
    status('ファイル版');
    return;
  }
  if (!['http:', 'https:'].includes(location.protocol) || !window.isSecureContext || !('serviceWorker' in navigator)) {
    status('');
    return;
  }

  const watch = (registration) => {
    if (registration.active) status('オフライン対応');
    if (registration.waiting) status('更新があります。学習後、アプリの画面をすべて閉じて開き直してください。');
    const worker = registration.installing;
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed') {
        status(registration.active
          ? '更新があります。学習後、アプリの画面をすべて閉じて開き直してください。'
          : 'オフライン対応');
      } else if (worker.state === 'redundant' && !registration.active) {
        status('オフライン準備に失敗しました。通信時に開き直してください。');
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  };
  const register = async () => {
    status('オフライン準備中…');
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
      watch(registration);
      registration.addEventListener('updatefound', () => watch(registration));
    } catch (_) {
      status('オフライン準備に失敗しました。オンラインでは利用できます。');
    }
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
