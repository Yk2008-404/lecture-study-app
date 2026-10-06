/** Optional status element: <p id="offline-status" class="muted"></p>. */
(() => {
  'use strict';
  const status = (message) => {
    const element = document.getElementById('offline-status');
    if (element) element.textContent = message;
  };
  if (location.protocol === 'file:') {
    status('このファイルで学習できます。問題と学習履歴は、このブラウザに保存されます。');
    return;
  }
  if (!['http:', 'https:'].includes(location.protocol) || !window.isSecureContext || !('serviceWorker' in navigator)) {
    status('問題と学習履歴は、このブラウザに保存されます。');
    return;
  }

  const watch = (registration) => {
    if (registration.active) status('オフラインでも開けます。問題と学習履歴は、このブラウザに保存されます。');
    if (registration.waiting) status('アプリの更新を準備しました。学習後にすべての画面を閉じて、開き直すと更新されます。');
    const worker = registration.installing;
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed') {
        status(registration.active
          ? 'アプリの更新を準備しました。学習後にすべての画面を閉じて、開き直すと更新されます。'
          : 'オフラインの準備ができました。次回から通信がなくても開けます。');
      } else if (worker.state === 'redundant' && !registration.active) {
        status('オフラインの準備ができませんでした。通信があるときに、もう一度開いてください。');
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  };
  const register = async () => {
    status('オフラインで使うための準備をしています。');
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
      watch(registration);
      registration.addEventListener('updatefound', () => watch(registration));
    } catch (_) {
      status('オフラインの準備ができませんでした。通信があるときは、このまま学習できます。');
    }
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
