/* One directional line, real pivot coordinates and a separate projected segment. */
function worldRenderTrendChart(result, candles) {
  const svg = trendlineEl('tl-chart');
  if (!svg) return;
  const width = Math.max(240, Math.round(svg.parentElement.clientWidth - 2));
  const height = Math.max(300, Math.round(svg.parentElement.clientHeight - 2));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const usable = (candles || []).filter(trendlineValidCandle);
  const all = result.found ? result.all : usable.slice(-96);
  const first = result.found ? Math.max(0, Math.min(all.length - 96, result.anchorOne.index - 4)) : 0;
  const rows = all.slice(first);
  svg.dataset.symbol = trendlineState.symbol;
  delete svg.dataset.side;
  delete svg.dataset.startTime;
  delete svg.dataset.endTime;
  if (!rows.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--m)" font-size="13">${trendlineState.loading ? 'Загружаем свечи…' : 'Нет свечей для этого рынка'}</text>`;
    return;
  }
  const mobile = width < 520, left = 16, right = width - (mobile ? 80 : 106), top = 62, bottom = height - 38;
  const prices = rows.flatMap(c => [c.high, c.low]);
  if (result.found) prices.push(result.anchorOne.price, result.anchorTwo.price, result.currentLine);
  const low = Math.min(...prices), high = Math.max(...prices), padding = (high - low || high * .01 || 1) * .12;
  const min = low - padding, max = high + padding;
  const x = i => left + i / Math.max(1, rows.length - 1) * (right - left);
  const y = value => top + (max - value) / (max - min) * (bottom - top);
  const body = Math.max(1.2, (right - left) / rows.length * .65), parts = [];
  for (let i = 0; i <= 4; i++) {
    const value = max - (max - min) * i / 4, yy = y(value);
    const axisPrice = value < .000001 ? '$' + value.toExponential(3) : '$' + value.toLocaleString('en-US', {maximumSignificantDigits: 5});
    parts.push(`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="var(--world-edge)" stroke-dasharray="2 6"/><text x="${right + 8}" y="${yy + 4}" fill="var(--m)" font-size="${mobile ? 10 : 11}">${axisPrice}</text>`);
  }
  rows.forEach((c, i) => {
    const color = c.close >= c.open ? 'var(--g)' : 'var(--r)';
    parts.push(`<g class="tl-candle" data-time="${c.time}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}" opacity=".8"/><rect x="${x(i) - body / 2}" y="${y(Math.max(c.open, c.close))}" width="${body}" height="${Math.max(1.2, Math.abs(y(c.open) - y(c.close)))}" fill="${color}" opacity=".85"/></g>`);
  });
  const current = rows.at(-1).close;
  parts.push(`<line x1="${left}" x2="${right}" y1="${y(current)}" y2="${y(current)}" stroke="var(--m)" stroke-dasharray="2 6" opacity=".6"/>`);
  if (result.found) {
    const color = result.side === 'support' ? 'var(--tl-up)' : 'var(--tl-down)';
    const a = result.anchorOne, b = result.anchorTwo, end = all.length - 1;
    const ax = x(a.index - first), ay = y(a.price), bx = x(b.index - first), by = y(b.price), ex = x(rows.length - 1), ey = y(result.currentLine);
    svg.dataset.side = result.side;
    svg.dataset.startTime = String(a.time);
    svg.dataset.endTime = String(all[end].time);
    const direction = result.side === 'support' ? 'ВОСХОДЯЩАЯ' : 'НИСХОДЯЩАЯ';
    parts.push(`<path d="M${ax},${ay} L${bx},${by} L${ex},${ey}" fill="none" stroke="${color}" stroke-width="9" opacity=".12"/><line class="tl-trend-core" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="3"/><line class="tl-trend-projection" x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="2.5" stroke-dasharray="7 5"/>`);
    const label = (xx, yy, text, boxWidth) => {
      const boxX = Math.max(left, Math.min(right - boxWidth, xx - boxWidth / 2));
      const boxY = Math.max(34, Math.min(bottom - 24, yy - 35));
      return `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="23" fill="var(--bg-card)" stroke="${color}"/><text x="${boxX + boxWidth / 2}" y="${boxY + 15}" fill="${color}" text-anchor="middle" font-size="11" font-weight="750">${text}</text>`;
    };
    // Separate labels when pivots are near each other on a narrow viewport.
    [a, b].forEach((p, i) => {
      const xx = x(p.index - first), yy = y(p.price);
      parts.push(`<rect class="tl-anchor" data-anchor="${i + 1}" data-price="${p.price}" data-time="${p.time}" x="${xx - 5}" y="${yy - 5}" width="10" height="10" fill="var(--bg-card)" stroke="${color}" stroke-width="2.5"><title>Опора ${i + 1} · ${trendlinePrice(p.price)} · ${trendlineTime(p.time)} UTC</title></rect>`);
    });
    parts.push(label(ax, ay, 'СТАРТ · 1', 82));
    if (bx - ax > 90) parts.push(label(bx, by, 'ОПОРА · 2', 84));
    parts.push(`<rect class="tl-line-end" data-price="${result.currentLine}" x="${ex - 5}" y="${ey - 5}" width="10" height="10" fill="${color}" stroke="var(--bg-card)" stroke-width="2"/>`);
    // Keep the end label on the other side of the line from pivot 2's label.
    const endLabelY = Math.max(34, Math.min(bottom - 24, result.side === 'support' ? Math.min(ey - 62, by - 64) : ey + 14));
    parts.push(`<line x1="${ex}" x2="${ex}" y1="${ey}" y2="${result.side === 'support' ? endLabelY + 23 : endLabelY}" stroke="${color}" stroke-dasharray="2 3" opacity=".75"/><rect class="tl-end-label" x="${right - 76}" y="${endLabelY}" width="76" height="23" fill="var(--bg-card)" stroke="${color}"/><text x="${right - 38}" y="${endLabelY + 15}" fill="${color}" text-anchor="middle" font-size="11" font-weight="750">КОНЕЦ</text><text class="tl-direction-label" x="${left}" y="24" fill="${color}" font-size="12" font-weight="800">${result.side === 'support' ? '↗' : '↘'} ${direction}</text>`);
    const event = (time, name, eventColor) => {
      const index = rows.findIndex(c => c.time === time);
      if (index < 0) return;
      const xx = x(index), yy = y(rows[index].close), labelX = Math.max(left + 4, Math.min(right - 55, xx + 9));
      parts.push(`<rect x="${xx - 4}" y="${yy - 4}" width="8" height="8" fill="${eventColor}" stroke="var(--bg-card)"/><text x="${labelX}" y="${Math.max(top + 12, Math.min(bottom - 4, yy + 22))}" fill="${eventColor}" font-size="11" font-weight="700">${name}</text>`);
    };
    if (result.breakTime) event(result.breakTime, 'ПРОБОЙ', 'var(--r)');
    if (result.retestTime) event(result.retestTime, 'РЕТЕСТ', 'var(--g)');
    svg.setAttribute('aria-label', `${trendlineState.symbol}/USDT: ${direction.toLowerCase()} линия. Начало ${trendlinePrice(a.price)}, вторая опора ${trendlinePrice(b.price)}, продолжение ${trendlinePrice(result.currentLine)}.`);
  } else {
    parts.push(`<text x="${left}" y="24" fill="var(--m)" font-size="12">Нет подтверждённой наклонной линии</text>`);
    svg.setAttribute('aria-label', `${trendlineState.symbol}/USDT: свечи, подтверждённая наклонная линия не найдена.`);
  }
  const longWindow = rows.at(-1).time - rows[0].time > 20 * 3600000;
  const time = stamp => longWindow ? new Date(stamp).toLocaleDateString('ru-RU', {timeZone: 'UTC', day: '2-digit', month: '2-digit'}) : new Date(stamp).toLocaleTimeString('ru-RU', {timeZone: 'UTC', hour: '2-digit', minute: '2-digit'});
  [0, Math.floor((rows.length - 1) / 2), rows.length - 1].forEach((i, tick) => parts.push(`<text x="${x(i)}" y="${height - 13}" fill="var(--m)" font-size="11" text-anchor="${tick === 0 ? 'start' : tick === 2 ? 'end' : 'middle'}">${time(rows[i].time)}${tick === 2 ? ' UTC' : ''}</text>`));
  svg.innerHTML = parts.join('');
}

function trendlinePrice(value) {
  if (!Number.isFinite(value)) return '—';
  return '$' + value.toLocaleString('en-US', {maximumSignificantDigits: 7});
}

document.addEventListener('DOMContentLoaded', () => {
  const svg = trendlineEl('tl-chart');
  if (!svg) return;
  let frame;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (svg.clientWidth && trendlineState.result) trendlineRenderChart(trendlineState.result, trendlineState.data?.candles[trendlineState.tf] || []);
    });
  }).observe(svg.parentElement);
}, {once: true});
