const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
function closeMenu() {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  mobileNav.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
mobileNav.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
const tabs = [...document.querySelectorAll('.workspace-tab')];
function selectTab(tab, focus = false) {
  tabs.forEach(item => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next], true);
  });
});
document.getElementById('year').textContent = String(new Date().getFullYear());

// Illustrative samples only. No live quote, account data or trading action.
const samples = {
  BTC: { entry: 64200, stop: 63800, target: 65000 },
  ETH: { entry: 3200, stop: 3160, target: 3280 },
  SOL: { entry: 145, stop: 143, target: 149 }
};
const demoShape = [.04,.10,.06,.16,.21,.15,.27,.32,.28,.41,.37,.53,.47,.69,.62,.87,.95,.86,.77,.81,.66,.59,.51,.42,.30,.39,.28,1/3];
const demoChart = document.getElementById('demo-market-chart');
const coinButtons = [...document.querySelectorAll('[data-coin]')];
const priceFormat = value => '$' + value.toLocaleString('en-US', { maximumFractionDigits: value < 200 ? 2 : 0 });
function renderSample(symbol) {
  const sample = samples[symbol];
  if (!sample) return;
  coinButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coin === symbol)));
  document.querySelectorAll('[data-sample-symbol]').forEach(node => { node.textContent = symbol + ' / USDT'; });
  for (const [field, value] of [['price', sample.entry], ['stop', sample.stop], ['target', sample.target]]) {
    document.querySelectorAll('[data-sample-' + field + ']').forEach(node => { node.textContent = priceFormat(value); });
  }
  document.querySelector('[data-sample-size]').textContent = (50 / (sample.entry - sample.stop)).toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' ' + symbol;
  const range = sample.target - sample.stop;
  const low = sample.stop - range * .22;
  const high = sample.target + range * .18;
  const y = value => 16 + (high - value) / (high - low) * 162;
  const plotWidth = 637;
  const parts = [];
  for (let line = 0; line < 5; line++) {
    const value = high - (high - low) * line / 4;
    const yy = y(value);
    parts.push(`<path d="M0 ${yy}H${plotWidth}" stroke="#30433b" stroke-opacity=".55"/><text class="chart-axis" x="651" y="${yy + 4}" fill="#8fa39b" font-size="13">${priceFormat(value)}</text>`);
  }
  for (let line = 0; line < 9; line++) parts.push(`<path d="M${line * 78} 16V208" stroke="#30433b" stroke-opacity=".35"/>`);
  parts.push(`<rect x="0" y="${y(sample.entry)}" width="${plotWidth}" height="${y(sample.stop) - y(sample.entry)}" fill="#b0f2a0" opacity=".055"/>`);
  for (const [value, color] of [[sample.stop,'#52c8ff'],[sample.target,'#a779ff']]) parts.push(`<path d="M0 ${y(value)}H${plotWidth}" stroke="${color}" stroke-opacity=".6" stroke-dasharray="4 5"/>`);
  demoShape.forEach((point,index) => {
    const close = sample.stop + point * range;
    const open = index ? sample.stop + demoShape[index-1] * range : close - range * .04;
    const wick = range * (.022 + index % 3 * .008);
    const xx = 12 + index * 22.3;
    const color = close >= open ? '#b0f2a0' : '#879a97';
    const bodyTop = Math.min(y(open),y(close));
    const bodyHeight = Math.max(2,Math.abs(y(open)-y(close)));
    parts.push(`<path d="M${xx} ${y(Math.max(open,close)+wick)}V${y(Math.min(open,close)-wick)}" stroke="${color}" stroke-width="1.5"/><rect x="${xx-4}" y="${bodyTop}" width="8" height="${bodyHeight}" fill="${color}"/><rect x="${xx-4}" y="${207-(8+index%5*3)}" width="8" height="${8+index%5*3}" fill="${color}" opacity=".25"/>`);
  });
  parts.push(`<path d="M0 ${y(sample.entry)}H${plotWidth}" stroke="#b0f2a0" stroke-dasharray="3 4"/><rect x="645" y="${y(sample.entry)-10}" width="73" height="21" fill="#233a29"/><text x="651" y="${y(sample.entry)+5}" fill="#b0f2a0" font-size="13" class="chart-axis">${priceFormat(sample.entry)}</text>`);
  ['08:00','16:00','00:00','08:00'].forEach((label,index) => parts.push(`<text class="chart-axis" x="${8+index*185}" y="230" fill="#8fa39b" font-size="12">${label}</text>`));
  demoChart.innerHTML = parts.join('');
  demoChart.setAttribute('aria-label','Демонстрационный свечной график ' + symbol + '. Данные вымышлены. Учебная цена ' + priceFormat(sample.entry) + '.');
}
coinButtons.forEach(button => button.addEventListener('click', () => renderSample(button.dataset.coin)));
renderSample('BTC');

// One-time, transform/opacity-only reveals; content stays visible without JS.
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: '0px 0px 30px 0px' });
  document.querySelectorAll('.intro, .section-heading, .tool-card, .workflow, .entry').forEach(node => {
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    node.classList.add('reveal-ready');
    observer.observe(node);
  });
}
