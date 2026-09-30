/* Small pixel accents use the same measurements as the surrounding cards. */
const pixelCharts = new Map();
const pixelBreadthHistory = { basket: '', points: [] };

function pixelSetMeter(id, value, { label, max = 100, segments = 20, valueText, caption = '' } = {}) {
  const host = document.getElementById(id);
  if (!host) return;
  const available = value != null && Number.isFinite(Number(value));
  const number = available ? Math.min(max, Math.max(0, Number(value))) : null;
  const signature = [number, max, segments, label, valueText, caption].join('|');
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.replaceChildren();
  const meter = document.createElement('div');
  meter.className = 'px-meter' + (available ? '' : ' is-unavailable');
  meter.style.setProperty('--segments', segments);
  meter.setAttribute('role', available ? 'meter' : 'img');
  meter.setAttribute('aria-label', label + (available ? '' : ': нет данных'));
  if (available) {
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(max));
    meter.setAttribute('aria-valuenow', String(number));
    meter.setAttribute('aria-valuetext', valueText || number + ' из ' + max);
  }
  const filled = available && number > 0 ? Math.max(1, Math.round(number / max * segments)) : 0;
  for (let i = 0; i < segments; i++) {
    const cell = document.createElement('i'), progress = i / Math.max(1, segments - 1);
    cell.className = 'px-meter-cell' + (i < filled ? ' is-filled' : '');
    cell.setAttribute('aria-hidden', 'true');
    cell.style.setProperty('--pixel-color', `rgb(${Math.round(56 + 102 * progress)},${Math.round(157 - 68 * progress)},${Math.round(255 - 11 * progress)})`);
    meter.append(cell);
  }
  host.append(meter);
  if (caption) {
    const copy = document.createElement('small');
    copy.className = 'px-meter-caption';
    copy.textContent = caption;
    host.append(copy);
  }
}

function pixelDrawChart(canvas) {
  const state = pixelCharts.get(canvas.id), width = Math.floor(canvas.clientWidth), height = 44;
  if (!state || !width) return;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const values = state.values;
  if (!values.length) return;
  const low = Math.min(...values), high = Math.max(...values), span = high - low;
  const x = i => 5 + i / Math.max(1, values.length - 1) * (width - 10);
  const y = value => span ? 5 + (high - value) / span * (height - 13) : height / 2;
  const line = ctx.createLinearGradient(0, 0, width, 0);
  line.addColorStop(0, '#389dff'); line.addColorStop(1, '#9e59f4');
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, 'rgba(120,105,246,.20)'); fill.addColorStop(1, 'rgba(56,157,255,0)');
  ctx.beginPath(); ctx.moveTo(x(0), y(values[0]));
  for (let i = 1; i < values.length; i++) { ctx.lineTo(x(i), y(values[i - 1])); ctx.lineTo(x(i), y(values[i])); }
  if (values.length > 1) {
    ctx.lineTo(x(values.length - 1), height); ctx.lineTo(x(0), height); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x(0), y(values[0]));
    for (let i = 1; i < values.length; i++) { ctx.lineTo(x(i), y(values[i - 1])); ctx.lineTo(x(i), y(values[i])); }
    ctx.strokeStyle = line; ctx.lineWidth = 1.6; ctx.lineJoin = 'miter'; ctx.stroke();
  }
  ctx.fillStyle = '#9e59f4';
  ctx.fillRect(Math.round(x(values.length - 1)) - 3, Math.round(y(values.at(-1))) - 3, 6, 6);
}

const pixelChartResize = new ResizeObserver(entries => entries.forEach(entry => pixelDrawChart(entry.target)));
function pixelSparkline(id, source, { label, caption }) {
  const host = document.getElementById(id);
  if (!host) return;
  const values = (source || []).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  let canvas = host.querySelector('canvas'), copy = host.querySelector('.px-chart-caption');
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.id = id + '-canvas'; canvas.setAttribute('role', 'img');
    copy = document.createElement('small'); copy.className = 'px-chart-caption';
    host.replaceChildren(canvas, copy); pixelChartResize.observe(canvas);
  }
  canvas.hidden = !values.length;
  canvas.dataset.points = values.length;
  canvas.setAttribute('aria-label', values.length ? `${label}. Начало ${values[0]}, конец ${values.at(-1)}, минимум ${Math.min(...values)}, максимум ${Math.max(...values)}.` : label + ': нет данных');
  copy.textContent = values.length ? caption : 'Ожидаем данные';
  pixelCharts.set(canvas.id, { values });
  pixelDrawChart(canvas);
}

function pixelRecordBreadth(snapshot) {
  if (!snapshot || snapshot.breadth == null || !Number.isFinite(snapshot.breadth)) return [];
  const basket = (snapshot.entries || []).map(entry => entry.symbol).sort().join(','), bucket = Math.floor(snapshot.at / 60000);
  if (pixelBreadthHistory.basket !== basket) { pixelBreadthHistory.basket = basket; pixelBreadthHistory.points = []; }
  const points = pixelBreadthHistory.points, observation = { bucket, value: snapshot.breadth };
  if (points.at(-1)?.bucket === bucket) points[points.length - 1] = observation;
  else points.push(observation);
  pixelBreadthHistory.points = points.slice(-32);
  return pixelBreadthHistory.points.map(point => point.value);
}

function pixelRenderOverview(analysis, snapshot) {
  const candles = analysis ? (marketIntelState.candles['1h'] || []).slice(-24) : [];
  pixelSparkline('ov-price-spark', candles.map(candle => candle.close), { label: 'Цена ' + overviewState.symbol + ', часовые свечи', caption: 'Цена · часовых свечей: ' + candles.length });
  pixelSparkline('ov-volume-spark', candles.map(candle => candle.volume), { label: 'Торговый объём ' + overviewState.symbol + ', часовые свечи', caption: 'Объём · часовых свечей: ' + candles.length });
  const breadth = pixelRecordBreadth(snapshot);
  pixelSparkline('ov-breadth-spark', breadth, { label: 'Ширина рынка, процент растущих монет', caption: breadth.length > 1 ? 'Ширина · наблюдения за этот сеанс' : 'Ширина · история накапливается' });
  pixelSetMeter('ov-signal-meter', analysis?.score, { label: 'Сила рыночного сигнала', caption: 'Сила сигнала · 0–100' });
}

function pixelRenderRadar(snapshot) {
  const breadth = pixelRecordBreadth(snapshot);
  pixelSparkline('env-breadth-spark', breadth, { label: 'Ширина рынка, процент растущих монет', caption: breadth.length > 1 ? 'Наблюдения за этот сеанс' : 'История накапливается' });
}

function pixelRenderBattle(result, effectivePct) {
  pixelSetMeter('bs-signal-meter', result.confidence, { label: 'Сила сигнала', segments: 10 });
  pixelSetMeter('bs-long-meter', result.longScore, { label: 'Оценка сценария Long' });
  pixelSetMeter('bs-short-meter', result.shortScore, { label: 'Оценка сценария Short' });
  pixelSetMeter('bs-risk-meter', effectivePct, { label: 'Риск от баланса', max: 1.5, segments: 12, valueText: effectivePct.toFixed(2) + '% от баланса', caption: 'Шкала риска · 0–1.5%' });
}

function pixelRenderSessionTimeline(id, session, now = new Date()) {
  const host = document.getElementById(id);
  if (!host || !session.schedule?.length) return;
  host.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'px-session-heading';
  const title = document.createElement('strong'); title.textContent = 'Сессии · UTC';
  const clock = document.createElement('span'); clock.textContent = environmentUtcTime(now) + ' UTC';
  heading.append(title, clock);
  const track = document.createElement('div'); track.className = 'px-session-track';
  track.setAttribute('role', 'img');
  const start = session.schedule[0].start, end = session.schedule.at(-1).end, dayLength = end - start;
  const names = { ASIA: 'АЗИЯ', LONDON: 'ЛОНДОН', OVERLAP: 'LDN × NY', NEW_YORK: 'НЬЮ-ЙОРК', OFF_HOURS: 'ПАУЗА' };
  const descriptions = [];
  session.schedule.forEach(segment => {
    const block = document.createElement('div'), code = segment.phase.code;
    const active = now.getTime() >= segment.start && now.getTime() < segment.end;
    block.className = 'px-session-block ' + code.toLowerCase() + (active ? ' is-active' : '');
    block.style.left = ((segment.start - start) / dayLength * 100) + '%';
    block.style.width = ((segment.end - segment.start) / dayLength * 100) + '%';
    const range = environmentUtcTime(segment.start) + '–' + (segment.end === end ? '24:00' : environmentUtcTime(segment.end));
    block.title = segment.phase.title + ' · ' + range + ' UTC';
    block.setAttribute('aria-hidden', 'true');
    worldAttachSessionScene(block, code);
    const name = document.createElement('span'); name.textContent = names[code]; block.append(name);
    descriptions.push(block.title); track.append(block);
  });
  const marker = document.createElement('i'); marker.className = 'px-session-now'; marker.setAttribute('aria-hidden', 'true');
  marker.style.left = Math.max(0, Math.min(100, (now.getTime() - start) / dayLength * 100)) + '%';
  track.append(marker);
  track.setAttribute('aria-label', descriptions.join('. ') + '. Сейчас ' + environmentUtcTime(now) + ' UTC: ' + session.phase.title);
  const ticks = document.createElement('div'); ticks.className = 'px-session-ticks'; ticks.setAttribute('aria-hidden', 'true');
  ['00:00', '06:00', '12:00', '18:00', '24:00'].forEach(time => { const tick = document.createElement('span'); tick.textContent = time; ticks.append(tick); });
  const next = document.createElement('small'); next.className = 'px-session-caption';
  next.textContent = session.eventLabel + ' · ' + environmentUtcTime(session.transition) + ' UTC · через ' + environmentCountdown(session.minutes);
  host.append(heading, track, ticks, next);
}

new MutationObserver(() => pixelCharts.forEach((_, id) => { const canvas = document.getElementById(id); if (canvas) pixelDrawChart(canvas); })).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
