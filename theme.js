(function () {
  'use strict';

  const STORAGE_KEY = 'study-app.theme.v1';
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const normalize = (value) => value === 'light' || value === 'dark' ? value : 'system';
  let preference = 'system';
  try { preference = normalize(window.localStorage.getItem(STORAGE_KEY)); }
  catch (_) { /* The theme remains usable when storage is unavailable. */ }

  function applyTheme() {
    const theme = preference === 'system' ? (media && media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#151724' : '#5253d9');
    const select = document.getElementById('theme-select');
    if (select) select.value = preference;
  }

  // Set the root theme before the page stylesheet is parsed.
  applyTheme();

  function connectSelect() {
    const select = document.getElementById('theme-select');
    if (!select) return;
    select.value = preference;
    select.addEventListener('change', () => {
      preference = normalize(select.value);
      applyTheme();
      try { window.localStorage.setItem(STORAGE_KEY, preference); }
      catch (_) { /* Keep the chosen theme for this page even if it cannot be saved. */ }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connectSelect, { once: true });
  else connectSelect();

  function followSystem() {
    if (preference === 'system') applyTheme();
  }
  if (media) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', followSystem);
    else if (typeof media.addListener === 'function') media.addListener(followSystem);
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    preference = normalize(event.newValue);
    applyTheme();
  });
})();
