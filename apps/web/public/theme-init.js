/* global window, document */
// Applies the saved colour theme before the first paint (external file: the CSP forbids inline scripts).
(function () {
  try {
    var theme = window.localStorage.getItem('casino-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    // Storage unavailable (private mode, blocked site data): keep the default dark theme.
  }
})();
