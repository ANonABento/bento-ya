// Applies the persisted theme before React mounts to avoid a light/dark
// flash on cold start. Lives in /public so Vite serves it at /theme-preload.js
// from the same origin as the document, which satisfies the bundled-app CSP
// (script-src 'self'). Keep this file dependency-free; it runs as a classic
// script before any module code.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('bento-theme-preference');
  } catch (_) {
    // localStorage may be unavailable (private mode, SSR, etc.); fall through.
  }
  var theme = 'dark';
  if (stored === 'light') {
    theme = 'light';
  } else if (stored === 'system' || !stored) {
    theme =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
