/* Pixel materials decorate existing values; chart coordinates and timestamps stay authoritative. */
let worldPoolGeometry = null;
let worldPoolLinkFrame = 0;
const WORLD_PANEL_SELECTOR = '.world-window,.tl-card,.tl-detail,.tl-tf-card,.tl-plan-cell,.ov-card,.ov-market-table,.px-session-timeline,.env-card,.wt-card,.wt-signal-card,.mi-card,.lq-card,.lq-vrvp-metrics>div,.bs-verdict,.bs-scenario,.bs-mission,.bs-matrix,.history-rail,.review-card,.dash-card,#add-trade-form';

function worldFitPanels(root = document) {
  const panels = [...root.querySelectorAll(WORLD_PANEL_SELECTOR)];
  if (root.matches?.(WORLD_PANEL_SELECTOR)) panels.unshift(root);
  panels.forEach(panel => {
    if (panel.classList.contains('world-game-panel')) return;
    panel.classList.add('world-game-panel');
    const fittings = worldElement('span', 'world-panel-fittings'); fittings.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) fittings.append(worldElement('i'));
    panel.append(fittings);
  });
}

function worldSetPoolGeometry(geometry) {
  worldPoolGeometry = geometry;
  cancelAnimationFrame(worldPoolLinkFrame);
  worldPoolLinkFrame = requestAnimationFrame(worldDrawPoolConnection);
}

function worldDrawPoolConnection() {
  const workspace = document.querySelector('.world-workspace'), chart = document.getElementById('world-overview-chart');
  if (!workspace || !chart) return;
  let canvas = document.getElementById('world-pool-connection');
  if (!canvas) {canvas = worldElement('canvas', 'world-pool-connection'); canvas.id = 'world-pool-connection'; canvas.setAttribute('aria-hidden', 'true'); workspace.append(canvas);}
  const width = workspace.clientWidth, height = workspace.clientHeight, dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
  const selection = worldLiquiditySelection?.symbol === overviewState.symbol ? worldLiquiditySelection : null;
  const row = [...document.querySelectorAll('#ov-world-liquidity .world-pool[role="button"]')].find(node => Number(node.dataset.price) === selection?.price);
  canvas.hidden = !selection || !row || !worldPoolGeometry || !worldOverviewAvailable || !width;
  delete canvas.dataset.price; if (canvas.hidden) return;
  const host = workspace.getBoundingClientRect(), plot = chart.getBoundingClientRect(), pool = row.getBoundingClientRect();
  const end = {x: plot.left - host.left + worldPoolGeometry.right - 4, y: plot.top - host.top + worldPoolGeometry.y};
  const chartPanel = chart.closest('.world-candle-panel').getBoundingClientRect();
  const mapPanel = row.closest('.world-overview-liquidity').getBoundingClientRect();
  const sideBySide = mapPanel.left >= chartPanel.right - 1;
  const start = sideBySide ? {x: pool.left - host.left + 5, y: pool.top - host.top + pool.height / 2} : {x: pool.left - host.left + Math.min(28, pool.width / 2), y: pool.top - host.top + 3};
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const color = getComputedStyle(document.documentElement).getPropertyValue(selection.side === 'below' ? '--world-cyan' : '--world-violet').trim();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
  ctx.beginPath(); ctx.moveTo(Math.round(end.x), Math.round(end.y));
  if (sideBySide) {
    const bend = Math.round((chartPanel.right + mapPanel.left) / 2 - host.left);
    ctx.lineTo(bend, Math.round(end.y)); ctx.lineTo(bend, Math.round(start.y)); ctx.lineTo(Math.round(start.x), Math.round(start.y));
  } else {
    const gutter = Math.min(width - 5, Math.round(chartPanel.right - host.left - 6));
    const gap = Math.round((chartPanel.bottom + mapPanel.top) / 2 - host.top);
    ctx.lineTo(gutter, Math.round(end.y)); ctx.lineTo(gutter, gap); ctx.lineTo(Math.round(start.x), gap); ctx.lineTo(Math.round(start.x), Math.round(start.y));
  }
  ctx.stroke(); ctx.setLineDash([]);
  [start, end].forEach(point => {ctx.fillRect(Math.round(point.x) - 4, Math.round(point.y) - 4, 8, 8); ctx.clearRect(Math.round(point.x) - 2, Math.round(point.y) - 2, 4, 4);});
  canvas.dataset.price = String(selection.price); canvas.dataset.levelY = String(worldPoolGeometry.y);
}

function worldOreProfile(profile, geometry) {
  const {bins} = profile, {y, profileWidth, profileRight, binHeight, maxVolume} = geometry;
  return bins.map(bin => {
    const yy = y((bin.low + bin.high) / 2), barWidth = Math.max(1, bin.total / maxVolume * (profileWidth - 16));
    const sellWidth = barWidth * (bin.sell / (bin.total || 1)), buyWidth = barWidth - sellWidth, left = profileRight - barWidth;
    const inValue = bin.index >= profile.valueLow && bin.index <= profile.valueHigh, isPoc = bin.index === profile.pocIndex;
    let texture = '';
    for (let offset = 8; offset < barWidth - 1; offset += 8) texture += '<rect x="' + (left + offset) + '" y="' + (yy - binHeight / 2) + '" width="1.2" height="' + binHeight + '" fill="var(--world-inset)" opacity=".8"/>';
    return '<g class="world-ore-bin' + (isPoc ? ' is-poc' : '') + '" data-volume="' + bin.total + '" data-width="' + barWidth + '" data-bin="' + bin.index + '" opacity="' + (inValue ? '1' : '.43') + '" shape-rendering="crispEdges"><title>' + escHtml(miFmtPrice((bin.low + bin.high) / 2)) + ' · Оценочный объём ' + Number(bin.total).toLocaleString('ru-RU', {maximumFractionDigits: 2}) + '</title><rect x="' + left + '" y="' + (yy - binHeight / 2) + '" width="' + sellWidth + '" height="' + binHeight + '" fill="url(#vrvp-sell)"/><rect x="' + (left + sellWidth) + '" y="' + (yy - binHeight / 2) + '" width="' + buyWidth + '" height="' + binHeight + '" fill="url(#vrvp-buy)"/>' + texture + '<path d="M' + left + ' ' + (yy - binHeight / 2) + 'H' + profileRight + '" stroke="#d5e7ff" stroke-opacity=".26"/>' + (isPoc ? '<rect x="' + (left - 2) + '" y="' + (yy - binHeight / 2 - 2) + '" width="' + (barWidth + 4) + '" height="' + (binHeight + 4) + '" fill="none" stroke="var(--world-cyan)" stroke-width="2"/>' : '') + '</g>';
  }).join('');
}

function worldMarkOrePeak(profile, geometry) {
  const svg = document.getElementById('lq-vrvp-chart'); if (!svg) return;
  let crystal = document.getElementById('world-ore-peak');
  if (!crystal) {crystal = worldElement('span', 'world-ore-peak'); crystal.id = 'world-ore-peak'; crystal.setAttribute('aria-hidden', 'true'); svg.parentElement.append(crystal);}
  const bin = profile.bins.find(bin => bin.index === profile.pocIndex); if (!bin) {crystal.hidden = true; return;}
  const yy = geometry.y((bin.low + bin.high) / 2), barWidth = Math.max(1, bin.total / geometry.maxVolume * (geometry.profileWidth - 16));
  crystal.hidden = false; crystal.style.left = (geometry.profileRight - barWidth - 20) / svg.viewBox.baseVal.width * 100 + '%';
  crystal.style.top = yy / svg.viewBox.baseVal.height * 100 + '%'; crystal.title = 'POC · ' + miFmtPrice(profile.poc);
  crystal.dataset.price = String(profile.poc);
}

function worldHourglass(timestamp, now = Date.now()) {
  const clock = worldElement('span', 'world-hourglass'); clock.setAttribute('aria-hidden', 'true');
  clock.dataset.timestamp = String(timestamp);
  clock.append(worldElement('i', 'world-hourglass-cap top'), worldElement('i', 'world-hourglass-cap bottom'));
  ['upper', 'lower'].forEach(side => {const chamber = worldElement('i', 'world-hourglass-chamber ' + side); chamber.append(worldElement('b', 'world-hourglass-sand')); clock.append(chamber);});
  clock.append(worldElement('i', 'world-hourglass-grain')); worldUpdateHourglass(clock, now); return clock;
}

function worldUpdateHourglass(clock, now = Date.now()) {
  const remaining = Number(clock.dataset.timestamp) - now;
  const progress = miClamp(1 - remaining / 3600000, 0, 1);
  // Four discrete sand rows show the last hour, without implying more precision than the countdown.
  const rows = Math.round(progress * 4); clock.style.setProperty('--sand-upper', (4 - rows) * 25 + '%'); clock.style.setProperty('--sand-lower', rows * 25 + '%');
  clock.dataset.state = remaining <= 0 ? 'arrived' : remaining <= 3600000 ? 'flowing' : 'waiting'; clock.dataset.progress = String(progress);
  clock.title = 'Песок показывает последний час до публикации. ' + environmentEventCountdown(Number(clock.dataset.timestamp));
}

function worldRenderEventHourglasses(events) {
  const now = Date.now(), next = events.find(event => event.impact === 'high' && event.timestamp >= now - 10 * 60000) || events.find(event => event.timestamp >= now);
  if (!next) return;
  const row = [...document.querySelectorAll('.world-event-card')].find(card => card.dataset.eventId === next.id);
  const target = row?.querySelector('.world-event-countdown');
  if (target) {target.querySelector('.world-toy-beacon')?.remove(); target.prepend(worldHourglass(next.timestamp, now));}
}

function worldRenderOverviewHourglass() {
  const host = document.getElementById('ov-next-event'); if (!host) return;
  host.querySelector('.world-hourglass')?.remove();
  if (/unavailable|waiting/i.test(environmentState.source)) return;
  const now = Date.now(), next = environmentState.events.filter(event => event.impact === 'high' && event.timestamp >= now - 10 * 60000).sort((a, b) => a.timestamp - b.timestamp)[0];
  if (next) host.prepend(worldHourglass(next.timestamp, now));
}

function worldDrawSkyDepth() {
  const canvas = document.getElementById('world-sky-depth'); if (!canvas) return;
  const width = innerWidth, height = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2), dark = worldTheme() === 'dark';
  canvas.width = width * dpr; canvas.height = height * dpr; const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const edge = x => Math.abs(x / width - .5) > .34;
  for (let i = 0; i < 95; i++) {
    const x = Math.round(((i * 137.53 + 41) % 997) / 997 * width), yy = Math.round(((i * 91.7 + 17) % 613) / 613 * height);
    ctx.globalAlpha = edge(x) ? .7 : .13; ctx.fillStyle = i % 3 ? dark ? '#83bdff' : '#6d82c3' : dark ? '#b78aff' : '#9374b8';
    const size = i % 11 === 0 ? 3 : 1; ctx.fillRect(x, yy, size, size);
    if (edge(x) && size === 3) {ctx.globalAlpha = .27; ctx.fillRect(x - 3, yy + 1, 9, 1); ctx.fillRect(x + 1, yy - 3, 1, 9);}
  }
  const clusters = [[[.017,.28],[.052,.24],[.084,.29],[.058,.34]],[[.916,.6],[.955,.54],[.983,.6],[.951,.65]]];
  ctx.globalAlpha = dark ? .35 : .28; ctx.strokeStyle = dark ? '#a593e5' : '#8592c3'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
  clusters.forEach(points => {ctx.beginPath(); points.forEach(([x, yy], index) => index ? ctx.lineTo(Math.round(x * width), Math.round(yy * height)) : ctx.moveTo(Math.round(x * width), Math.round(yy * height))); ctx.stroke(); points.forEach(([x, yy]) => ctx.fillRect(Math.round(x * width) - 2, Math.round(yy * height) - 2, 4, 4));});
  ctx.globalAlpha = 1;
}

function worldInstallPixelCraft() {
  worldFitPanels();
  const profileTitle = document.querySelector('.lq-vrvp .lq-card-title');
  if (profileTitle?.querySelectorAll('.emoji-glyph').length > 1) profileTitle.querySelector('.world-heading-icon')?.remove();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {if (node.nodeType === 1 && !node.classList.contains('world-panel-fittings')) worldFitPanels(node);}))).observe(document.querySelector('.main') || document.body, {childList: true, subtree: true});
  const sky = worldElement('canvas', 'world-sky-depth'); sky.id = 'world-sky-depth'; sky.setAttribute('aria-hidden', 'true'); document.getElementById('world-space').after(sky);
  const veil = worldElement('div', 'world-sky-veil'); veil.setAttribute('aria-hidden', 'true'); sky.after(veil); worldDrawSkyDepth();
  let skyFrame; addEventListener('resize', () => {cancelAnimationFrame(skyFrame); skyFrame = requestAnimationFrame(worldDrawSkyDepth); worldSetPoolGeometry(worldPoolGeometry);});
  new MutationObserver(() => {worldDrawSkyDepth(); worldSetPoolGeometry(worldPoolGeometry);}).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  const workspace = document.querySelector('.world-workspace'); if (workspace) new ResizeObserver(() => worldSetPoolGeometry(worldPoolGeometry)).observe(workspace);
  const profile = document.getElementById('lq-vrvp-chart');
  if (profile) {
    let profileFrame;
    new ResizeObserver(() => {
      cancelAnimationFrame(profileFrame);
      profileFrame = requestAnimationFrame(() => {
        if (!profile.clientWidth) return;
        const width = Math.max(280, Math.round(profile.parentElement.clientWidth - 2)), height = Math.max(310, Math.round(profile.parentElement.clientHeight - 2));
        if (Math.abs(profile.viewBox.baseVal.width - width) > 1 || Math.abs(profile.viewBox.baseVal.height - height) > 1) liquidityRenderVRVP();
      });
    }).observe(profile.parentElement);
  }
  worldRenderOverviewHourglass(); worldRenderEventHourglasses(environmentState.events.slice().sort((a,b) => a.timestamp - b.timestamp));
  setInterval(() => document.querySelectorAll('.world-hourglass').forEach(clock => worldUpdateHourglass(clock)), 30000);
}

document.addEventListener('DOMContentLoaded', worldInstallPixelCraft, {once: true});
