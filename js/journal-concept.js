/* Concept-faithful artwork, inventory and live candles. Decorative sprites never contain labels. */
let worldOverviewPeriod = '1h';
let worldOverviewCandles = [];
let worldOverviewAvailable = false;
let worldLiquiditySelection = null;
let worldChartViewport = {key:'', start:0, count:64};
let worldChartPendingRange = null;

function worldChartRange() {
  const count = Math.min(worldChartViewport.count, worldOverviewCandles.length);
  const start = Math.max(0, Math.min(worldChartViewport.start, worldOverviewCandles.length - count));
  return {start, count, candles:worldOverviewCandles.slice(start, start + count)};
}

function worldSyncChartCandles(candles, key) {
  const previous = worldChartRange();
  const retained = worldChartPendingRange || {atEnd:previous.start + previous.count >= worldOverviewCandles.length, firstTime:previous.candles[0]?.time};
  worldOverviewCandles = candles;
  if (!candles.length) {worldChartPendingRange = retained; return;}
  worldChartPendingRange = null;
  if (worldChartViewport.key !== key) worldChartViewport = {key, start:Math.max(0, candles.length - 64), count:Math.min(64, candles.length)};
  else {
    worldChartViewport.count = Math.min(worldChartViewport.count, candles.length);
    const retainedStart = candles.findIndex(candle => candle.time === retained.firstTime);
    worldChartViewport.start = retained.atEnd ? candles.length - worldChartViewport.count : retainedStart >= 0 ? retainedStart : worldChartViewport.start;
    worldChartViewport.start = worldChartRange().start;
  }
}

function worldZoomChart(delta, anchor = .5) {
  const range = worldChartRange();
  if (range.count < 2 || !delta) return;
  const minimum = Math.min(12, worldOverviewCandles.length);
  const count = Math.max(minimum, Math.min(worldOverviewCandles.length, Math.round(range.count * Math.exp(Math.max(-240, Math.min(240, delta)) * .002))));
  anchor = Math.max(0, Math.min(1, anchor));
  worldChartViewport.count = count;
  worldChartViewport.start = Math.max(0, Math.min(worldOverviewCandles.length - count, Math.round(range.start + anchor * (range.count - count))));
  worldDrawCandles();
}

function worldResetChart() {
  worldChartViewport.count = Math.min(64, worldOverviewCandles.length);
  worldChartViewport.start = Math.max(0, worldOverviewCandles.length - worldChartViewport.count);
  worldDrawCandles();
}

async function worldSelectLiquidityLevel(pool, targetId) {
  const symbol = targetId === 'ov-world-liquidity' ? overviewState.symbol : liquidityState.symbol;
  if (targetId !== 'ov-world-liquidity') {
    showPage('overview', document.querySelector('[data-page="overview"]'));
    if (overviewState.symbol !== symbol) await overviewSelectSymbol(symbol);
  }
  if(overviewState.symbol!==symbol)return;
  worldLiquiditySelection = {price:pool.price,name:pool.name,symbol,short:pool.short,distancePct:pool.distancePct,distanceAtr:pool.distanceAtr,side:pool.side|| (pool.price>(marketIntelState.ticker?.price||worldOverviewCandles.at(-1)?.close||pool.price)?'above':'below')};
  if(targetId!=='ov-world-liquidity')worldRenderOverviewWorkspace(worldOverviewAvailable?miBuildAnalysis():null,environmentMarketSnapshot());
  worldUpdateSelectedLevel(); worldDrawCandles();
  document.getElementById('world-overview-chart')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}

function worldUpdateSelectedLevel() {
  const canvas=document.getElementById('world-overview-chart');if(!canvas)return;
  let chip=document.getElementById('world-selected-level');
  if(!chip){chip=worldElement('button','world-selected-level');chip.id='world-selected-level';chip.type='button';chip.addEventListener('click',()=>{worldLiquiditySelection=null;worldUpdateSelectedLevel();worldDrawCandles();});canvas.parentElement.after(chip);}
  const selected=worldLiquiditySelection?.symbol===overviewState.symbol?worldLiquiditySelection:null;
  chip.hidden=!selected;chip.textContent=selected?selected.name+' · '+miFmtPrice(selected.price)+(Number.isFinite(selected.distancePct)?' · '+selected.distancePct.toFixed(2)+'%':'')+(Number.isFinite(selected.distanceAtr)?' · '+selected.distanceAtr.toFixed(2)+' ATR':'')+'  ×':'';
  chip.setAttribute('aria-label',selected?'Убрать выбранный уровень '+selected.name:'Уровень не выбран');
  document.querySelectorAll('.world-pool[role="button"]').forEach(row=>{const active=Boolean(selected&&Number(row.dataset.price)===selected.price);row.classList.toggle('is-selected',active);row.setAttribute('aria-pressed',String(active));});
}

function worldOpenLiquidity() {
  liquidityState.symbol = overviewState.symbol;
  document.getElementById('lq-symbol-input').value = overviewState.symbol;
  showPage('liquidity', document.querySelector('[data-page="liquidity"]'));
}

function worldSelectChartPeriod(period) {
  if (!['15m', '1h', '4h'].includes(period)) return;
  worldOverviewPeriod = period;
  worldRenderOverviewWorkspace(worldOverviewAvailable ? miBuildAnalysis() : null, environmentMarketSnapshot());
}

function worldRenderOverviewWorkspace(analysis, snapshot) {
  const canvas = document.getElementById('world-overview-chart');
  if (!canvas) return;
  worldOverviewAvailable = Boolean(analysis);
  worldSyncChartCandles(analysis ? (marketIntelState.candles[worldOverviewPeriod] || []) : [], overviewState.symbol + ':' + worldOverviewPeriod);
  document.querySelectorAll('[data-world-tf]').forEach(button => {
    const active = button.dataset.worldTf === worldOverviewPeriod;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const symbol = overviewState.symbol;
  document.getElementById('world-top-score').textContent = analysis ? analysis.score + ' / 100' : '—';
  const breadth = snapshot.breadth;
  document.getElementById('world-top-breadth').textContent = breadth == null ? '—' : Math.round(breadth) + '% растут';
  pixelSetMeter('world-top-meter', analysis?.score, {label:'Сила рыночного контекста',caption:''});
  document.getElementById('world-chart-title').textContent = symbol + ' / USDT';
  const priceNode=document.getElementById('world-chart-price'),priceText=analysis ? miFmtPrice(analysis.current) : '—';
  if(priceNode.textContent!==priceText&&priceNode.dataset.hasPrice==='true'&&analysis){priceNode.classList.remove('world-price-updated');void priceNode.offsetWidth;priceNode.classList.add('world-price-updated');}
  priceNode.textContent=priceText;priceNode.dataset.hasPrice=String(Boolean(analysis));
  const last = worldOverviewCandles.at(-1);
  document.getElementById('world-chart-range').textContent = last ? 'H ' + miFmtPrice(last.high) + ' · L ' + miFmtPrice(last.low) : 'Нет свечных данных';
  document.getElementById('world-chart-source').textContent = last ? worldOverviewCandles.length + ' свечей · ' + ({'15m':'15 минут','1h':'1 час','4h':'4 часа'})[worldOverviewPeriod] + ' · ' + (marketIntelState.source || 'BINANCE') : 'Ожидаем источник';
  document.getElementById('world-chart-empty').hidden = worldOverviewCandles.length > 1;
  document.getElementById('world-chart-tooltip').hidden = true;
  canvas.setAttribute('aria-label', 'Свечной график ' + symbol + ', ' + worldOverviewPeriod + ', ' + worldOverviewCandles.length + ' свечей' + (last ? ', последняя цена ' + miFmtPrice(last.close) : ', нет данных'));
  canvas.dataset.symbol = symbol; canvas.dataset.period = worldOverviewPeriod;
  const tiles = document.getElementById('world-market-tiles');
  tiles.replaceChildren();
  (snapshot.entries || []).slice(0, 6).forEach(entry => {
    const change = Number(entry.change);
    const available = entry.change != null && Number.isFinite(change);
    const tile = worldElement('button', 'world-market-tile ' + (available ? change >= 0 ? 'positive' : 'negative' : 'unavailable'));
    tile.type = 'button'; tile.append(worldElement('strong', null, entry.symbol), worldElement('span', null, available ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '—'));
    tile.addEventListener('click', () => overviewSelectSymbol(entry.symbol, tile));
    tiles.append(tile);
  });
  if (!tiles.children.length) tiles.append(worldElement('span', 'world-empty-note', 'Рыночный поток загружается'));
  const map = document.getElementById('ov-world-liquidity');
  if (analysis && marketIntelState.candles[liquidityState.tf]?.length) {
    const data = liquidityBuild();
    // A balanced viewport around the price: nearest live levels on both sides.
    const above = data.above.slice(0, 2), below = data.below.slice(0, 2);
    const pools = above.concat(below);
    if(worldLiquiditySelection?.symbol===symbol){const selectedPool=data.pools.find(pool=>pool.price===worldLiquiditySelection.price);if(selectedPool){Object.assign(worldLiquiditySelection,{distancePct:selectedPool.distancePct,distanceAtr:selectedPool.distanceAtr,side:selectedPool.price>data.current?'above':'below'});if(!pools.includes(selectedPool)){if(pools.length>=4)pools.pop();pools.push(selectedPool);}}}
    if (pools.length < 4) {
      data.active.filter(p => !pools.includes(p)).sort((a,b) => a.distancePct - b.distancePct).slice(0, 4 - pools.length).forEach(p => pools.push(p));
    }
    worldRenderLiquidity({...data, pools: pools.sort((a,b) => b.price - a.price)}, 'ov-world-liquidity');
    document.getElementById('world-map-gravity').textContent = data.gravity;
  } else {
    map.replaceChildren(worldElement('div', 'world-empty-note', 'Уровни появятся после загрузки рыночных данных'));
    document.getElementById('world-map-gravity').textContent = '—';
  }
  if(worldLiquiditySelection&&worldLiquiditySelection.symbol!==symbol)worldLiquiditySelection=null;
  worldUpdateSelectedLevel();worldDrawCandles();
  if(typeof worldRenderOrientation==='function')worldRenderOrientation(analysis,snapshot);
}

function worldDrawCandles(cursor = -1) {
  const canvas = document.getElementById('world-overview-chart');
  if (!canvas || !canvas.clientWidth) return;
  const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const range = worldChartRange(), candles = range.candles;
  canvas.dataset.visibleCandles = String(range.count); canvas.dataset.startIndex = String(range.start);
  const source = document.getElementById('world-chart-source');
  if (source && candles.length) source.textContent = range.count + ' из ' + worldOverviewCandles.length + ' свечей · ' + ({'15m':'15 минут','1h':'1 час','4h':'4 часа'})[worldOverviewPeriod] + ' · ' + (marketIntelState.source || 'BINANCE');
  if (candles.length < 2) {if(typeof worldSetPoolGeometry==='function')worldSetPoolGeometry(null);return;}
  const dark = worldTheme() === 'dark';
  const colors = {grid:dark ? '#293451' : '#d9e0ef', caption:dark ? '#94a8cd' : '#617494', up:dark ? '#54d1d5' : '#158db0', down:dark ? '#ae88ed' : '#9260d7', text:dark ? '#e8efff' : '#19384f'};
  const left = 10, right = width - 73, top = 12, bottom = height - 61;
  const selection = worldLiquiditySelection?.symbol===canvas.dataset.symbol ? worldLiquiditySelection : null;
  const low = Math.min(...candles.map(c => c.low),selection?.price??Infinity), high = Math.max(...candles.map(c => c.high),selection?.price??-Infinity);
  const pad = (high - low) * .13 || high * .01;
  const min = low - pad, max = high + pad, y = value => top + (max - value) / (max - min) * (bottom - top);
  ctx.font = '600 11px Inter, Arial, sans-serif'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const value = max - i / 4 * (max - min), yy = y(value);
    ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
    ctx.fillStyle = colors.caption; ctx.fillText(miFmtPrice(value), right + 8, yy + 4);
    ctx.strokeStyle=colors.caption;for(let tick=0;tick<5;tick++){const ty=yy+(tick-2)*4;if(ty>=top&&ty<=bottom){ctx.beginPath();ctx.moveTo(right,ty);ctx.lineTo(right+(tick===2?5:2),ty);ctx.stroke();}}
  }
  const step = (right - left) / candles.length, body = Math.max(.75, Math.min(8, step * .65));
  const maxVolume = Math.max(...candles.map(c => c.volume), 1);
  candles.forEach((c, i) => {
    const x = left + (i + .5) * step, color = c.close >= c.open ? colors.up : colors.down;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, y(c.high)); ctx.lineTo(Math.round(x) + .5, y(c.low)); ctx.stroke();
    ctx.fillRect(Math.round(x - body / 2), y(Math.max(c.open, c.close)), body, Math.max(2, Math.abs(y(c.open) - y(c.close))));
    ctx.globalAlpha = .38; ctx.fillRect(x - body / 2, height - 25 - c.volume / maxVolume * 24, body, c.volume / maxVolume * 24); ctx.globalAlpha = 1;
  });
  const last = candles.at(-1), yy = y(last.close);
  ctx.strokeStyle = colors.up; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = dark ? '#233e53' : '#ddf3fa'; ctx.fillRect(right + 2, yy - 10, 69, 20);
  ctx.fillStyle = colors.text; ctx.fillText(miFmtPrice(last.close), right + 7, yy + 4);
  const timeTicks = Math.max(2, Math.min(4, Math.floor((right - left) / 150)));
  for (let i = 0; i < timeTicks; i++) {
    const index = Math.round(i / (timeTicks - 1) * (candles.length - 1)), date = new Date(candles[index].time);
    const label = date.toLocaleString('ru-RU', {timeZone:'UTC', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    const x = left + (index + .5) * step;
    ctx.fillStyle = colors.caption; ctx.textAlign = i === 0 ? 'left' : i === timeTicks - 1 ? 'right' : 'center'; ctx.fillText(label, x, height - 7);
  }
  ctx.textAlign = 'left';
  if(selection){const levelY=y(selection.price),color=selection.side==='below'?colors.up:colors.down;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(left,levelY);ctx.lineTo(right,levelY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillRect(left,levelY-4,8,8);ctx.lineWidth=1;canvas.dataset.selectedPrice=String(selection.price);}else delete canvas.dataset.selectedPrice;
  if(typeof worldSetPoolGeometry==='function')worldSetPoolGeometry(selection?{right,y:y(selection.price)}:null);
  if (cursor >= 0 && cursor < candles.length) {
    const x = left + (cursor + .5) * step;
    ctx.strokeStyle = colors.caption; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 24); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors.up; ctx.fillRect(x - 3, y(candles[cursor].close) - 3, 6, 6);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const inventory = document.querySelector('.ov-coins'), slots = document.getElementById('world-inventory-slots');
  const clock = inventory?.querySelector('.ov-live-stamp');
  if (clock) document.querySelector('.ov-page-tabs').append(clock);
  if (inventory && slots) {
    slots.append(inventory);
    const extra = worldElement('button', 'world-empty-slot', '+'); extra.type = 'button'; extra.title = 'Найти другую монету'; extra.setAttribute('aria-label', extra.title);
    extra.addEventListener('click', () => { const input = document.getElementById('ov-symbol-input'); input.focus(); input.select(); }); inventory.append(extra);
  }
  const chart = document.getElementById('world-overview-chart'), tooltip = document.getElementById('world-chart-tooltip');
  if (!chart) return;
  let drag = null;
  chart.title = 'Колёсико — масштаб · Перетаскивание — история · Двойной щелчок — сброс';
  chart.tabIndex = 0;
  chart.addEventListener('wheel', event => {
    if (worldOverviewCandles.length < 2) return;
    event.preventDefault(); tooltip.hidden = true;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? chart.clientHeight : 1);
    worldZoomChart(delta, (event.clientX - chart.getBoundingClientRect().left - 10) / (chart.clientWidth - 83));
  }, {passive:false});
  chart.addEventListener('dblclick', () => {tooltip.hidden = true; worldResetChart();});
  chart.addEventListener('keydown', event => {
    if (!['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight'].includes(event.key) || worldOverviewCandles.length < 2) return;
    event.preventDefault(); tooltip.hidden = true;
    if (event.key === '0') worldResetChart();
    else if (event.key.startsWith('Arrow')) {
      const range = worldChartRange();
      worldChartViewport.start = Math.max(0, Math.min(worldOverviewCandles.length - range.count, range.start + (event.key === 'ArrowLeft' ? -1 : 1) * Math.max(1, Math.round(range.count / 5))));
      worldDrawCandles();
    } else worldZoomChart(event.key === '-' ? 100 : -100);
  });
  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0 || worldOverviewCandles.length < 2) return;
    const range = worldChartRange();
    drag = {id:event.pointerId, x:event.clientX, start:range.start, count:range.count};
    chart.setPointerCapture(event.pointerId); chart.classList.add('is-dragging'); tooltip.hidden = true;
  });
  const finishDrag = () => {drag = null; chart.classList.remove('is-dragging'); tooltip.hidden = true; worldDrawCandles();};
  chart.addEventListener('pointerup', finishDrag);
  chart.addEventListener('pointercancel', finishDrag);
  chart.addEventListener('lostpointercapture', finishDrag);
  chart.addEventListener('pointermove', event => {
    if (drag) {
      worldChartViewport.start = Math.max(0, Math.min(worldOverviewCandles.length - drag.count, drag.start - Math.round((event.clientX - drag.x) / (chart.clientWidth - 83) * drag.count)));
      worldDrawCandles(); return;
    }
    const range = worldChartRange();
    if (!range.count) return;
    const x = event.clientX - chart.getBoundingClientRect().left;
    if (x < 10 || x > chart.clientWidth - 73) {tooltip.hidden = true; worldDrawCandles(); return;}
    const index = Math.max(0, Math.min(range.count - 1, Math.floor((x - 10) / (chart.clientWidth - 83) * range.count)));
    const candle = range.candles[index];
    tooltip.hidden = false; tooltip.textContent = new Date(candle.time).toLocaleString('ru-RU', {timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) + ' UTC · O ' + miFmtPrice(candle.open) + ' · H ' + miFmtPrice(candle.high) + ' · L ' + miFmtPrice(candle.low) + ' · C ' + miFmtPrice(candle.close) + ' · V '+Number(candle.volume).toLocaleString('ru-RU',{maximumFractionDigits:2});
    worldDrawCandles(index);
  });
  chart.addEventListener('pointerleave', () => { tooltip.hidden = true; worldDrawCandles(); });
  new ResizeObserver(() => worldDrawCandles()).observe(chart);
  new MutationObserver(() => worldDrawCandles()).observe(document.documentElement, {attributes:true,attributeFilter:['data-theme']});
  document.fonts.ready.then(() => worldDrawCandles());
}, {once:true});
