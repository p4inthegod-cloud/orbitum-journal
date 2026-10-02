/* Applied before first paint; independent of market data and authentication. */
(function () {
  'use strict';
  var key = 'eternity-journal-theme';
  function apply(theme, save) {
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (save) { try { localStorage.setItem(key, theme); } catch (_) {} }
    document.querySelectorAll('.journal-theme-toggle').forEach(function (button) {
      var dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
      button.title = button.getAttribute('aria-label');
      button.querySelector('[data-theme-icon]').textContent = dark ? '☀' : '☾';
      button.querySelector('.theme-label').textContent = dark ? 'Светлая тема' : 'Тёмная тема';
    });
  }
  window.journalSetTheme = apply;
  window.journalToggleTheme = function () { apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true); };
  var saved = 'dark';
  try { saved = localStorage.getItem(key) || 'dark'; } catch (_) {}
  apply(saved, false);
  window.addEventListener('storage', function (event) { if (event.key === key) apply(event.newValue, false); });
  document.addEventListener('DOMContentLoaded', function () {
    apply(document.documentElement.dataset.theme, false);
    var input = document.getElementById('ov-symbol-input');
    var meta = document.getElementById('ov-price-meta');
    var icon = document.getElementById('ov-coin-icon');
    var name = document.getElementById('ov-coin-name');
    var names = MARKET_COIN_NAMES;
    function syncCoin() {
      var symbol = ((meta && meta.textContent || '').match(/^([A-Z0-9]+)/) || [])[1] || 'BTC';
      if (!icon || !name) return;
      var hasIcon = ['BTC','ETH','SOL','BNB','XRP'].includes(symbol);
      icon.hidden = !hasIcon;
      if (hasIcon) icon.src = 'assets/coins/' + symbol.toLowerCase() + '.svg';
      name.textContent = names[symbol] ? names[symbol] + ' · ' + symbol : symbol;
    }
    if (meta) new MutationObserver(syncCoin).observe(meta, { childList: true, characterData: true, subtree: true });
    syncCoin();
  });
})();
