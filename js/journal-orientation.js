/* Meaningful world objects: navigation, source-aware events and completed-scan comparisons. */
const worldWatchBaseline = new Map();
const worldWatchChanges = new Map();
let worldWatchComparisonAt = 0;

function worldToy(kind, label) {
  const toy = worldElement('span', 'world-toy world-toy-' + kind);
  toy.setAttribute('aria-hidden', 'true');
  if (label) toy.title = label;
  for (let i = 0; i < 3; i++) toy.append(worldElement('i'));
  return toy;
}

function worldRouteTo(id, step) {
  const target = document.getElementById(id);
  if (!target) return;
  document.querySelectorAll('.world-route-step').forEach(button => {
    const active = Number(button.dataset.step) === step;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  });
  target.focus({preventScroll: true});
  target.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

function worldInstallOrientation() {
  const pulse = document.getElementById('ov-pulse');
  if (pulse) {
    const hero = worldElement('section', 'world-market-hero world-window');
    hero.id = 'world-market-now'; hero.tabIndex = -1; hero.setAttribute('aria-label', 'Рынок сейчас');
    const heading = worldElement('header', 'world-hero-heading');
    const title = worldElement('h2', null, 'Рынок сейчас');
    title.prepend(worldToy('compass', 'Выбранный актив'));
    const asset = worldElement('span', 'world-asset-badge'); asset.id = 'world-hero-asset';
    heading.append(title, asset);
    const explanation = worldElement('div', 'world-market-explanation');
    explanation.append(worldToy('weather'));
    const copy = worldElement('div');
    const regime = worldElement('strong'); regime.id = 'world-hero-regime';
    const detail = worldElement('p'); detail.id = 'world-hero-copy';
    const bias = worldElement('span', 'world-hero-bias'); bias.id = 'world-hero-bias';
    copy.append(regime, bias, detail); explanation.append(copy);
    pulse.before(hero); hero.append(heading, pulse, explanation);
    const route = worldElement('nav', 'world-reading-route'); route.setAttribute('aria-label', 'Маршрут чтения обзора');
    [['compass', 'Что происходит', 'Цена, ширина, сессия и риск', 'world-market-now'], ['crystal', 'Где важные уровни', 'График и ближайшие пулы', 'world-overview-levels'], ['flag', 'Что проверить перед сделкой', 'Условие входа и отмена сценария', 'ov-action-card']].forEach(([kind, name, hint, id], index) => {
      const step = worldElement('button', 'world-route-step' + (index === 0 ? ' active' : '')); step.type = 'button'; step.dataset.step = index + 1;
      if (!index) step.setAttribute('aria-current', 'step');
      const content = worldElement('span'); content.append(worldElement('strong', null, name), worldElement('small', null, hint));
      step.append(worldToy(kind), worldElement('b', 'world-route-number', String(index + 1).padStart(2, '0')), content);
      step.addEventListener('click', () => worldRouteTo(id, index + 1)); route.append(step);
    });
    hero.before(route);
    const workspace = document.querySelector('.world-workspace');
    if (workspace) {workspace.id = 'world-overview-levels'; workspace.tabIndex = -1;}
    const action = document.getElementById('ov-action-card'); if (action) action.tabIndex = -1;
    let routeFrame;
    addEventListener('scroll', () => {
      cancelAnimationFrame(routeFrame);
      routeFrame = requestAnimationFrame(() => {
        if (!document.getElementById('page-overview').classList.contains('active')) return;
        const targets = ['world-market-now', 'world-overview-levels', 'ov-action-card'];
        let current = 1;
        targets.forEach((id, index) => {if (document.getElementById(id)?.getBoundingClientRect().top <= 180) current = index + 1;});
        document.querySelectorAll('.world-route-step').forEach(button => {
          const active = Number(button.dataset.step) === current;
          button.classList.toggle('active', active);
          if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
        });
      });
    }, {passive: true});
    [['.world-candle-panel .world-window-head', 'compass', '02 · Цена выбранного актива'], ['.world-overview-liquidity .world-window-head', 'crystal', '02 · Ближайшие уровни'], ['#ov-action-card .ov-card-head', 'flag', '03 · Проверка сценария']].forEach(([selector, kind, label]) => {
      const host = document.querySelector(selector); if (!host) return;
      const marker = worldToy(kind, label); marker.classList.add('world-zone-toy'); host.prepend(marker);
    });
    const mapLegend = document.querySelector('.world-map-legend small'); if (mapLegend) mapLegend.textContent = 'Огоньки = относительная сила · нажмите пул';
  }
  ['overview', 'liquidity', 'premarket', 'watchtower', 'marketintel', 'battle'].forEach(page => {
    const host = document.querySelector('#page-' + page + ' .ov-head, #page-' + page + ' .lq-head, #page-' + page + ' .env-head, #page-' + page + ' .wt-head, #page-' + page + ' .mi-head, #page-' + page + ' .bs-head');
    if (host) host.after(worldBuildLegend());
  });
  worldRenderOrientation(worldOverviewAvailable ? miBuildAnalysis() : null, environmentMarketSnapshot());
  worldRenderEventTrack();
  worldRenderWatchChanges();
  setInterval(worldRenderEventTrack, 30000);
}

function worldBuildLegend() {
  const legend = worldElement('details', 'world-symbol-guide');
  const summary = worldElement('summary'); summary.append(worldToy('book'), worldElement('span', null, 'Обозначения мира'), worldElement('small', null, 'Цвета, предметы и состояния'));
  legend.append(summary);
  const grid = worldElement('div', 'world-symbol-grid');
  [['compass', 'Выбранный актив', 'Этот тикер объединяет цену, график и карту в обзоре.'], ['crystal', 'Кристалл и огоньки', 'Неснятый пул. 1–3 огонька — относительная сила по модели, не объём в долларах.'], ['rock', 'Серый камень', 'Ликвидность уже снята. Серое поле с «Нет данных» означает недоступный источник.'], ['beacon', 'Маяк события', 'Ближайшая важная публикация. Янтарный — внимание к времени, не направление цены.'], ['flag', 'Флаг маршрута', 'Переход к проверке входа, риска и отмены сценария.'], ['square', 'Квадратный маркер', 'Последняя точка графика или показатель, изменившийся между завершёнными сканами.']].forEach(([kind, title, copy]) => {
    const row = worldElement('div'); const body = worldElement('div'); body.append(worldElement('strong', null, title), worldElement('p', null, copy)); row.append(worldToy(kind), body); grid.append(row);
  });
  const colors = worldElement('p', 'world-color-key', 'Голубой: цена на графике / пулы снизу. Фиолетовый: EMA / пулы сверху. Рост и снижение отмечены также знаком +/− и словами. Цвет предмета не является сигналом входа.');
  legend.append(grid, colors); return legend;
}

function worldRenderOrientation(analysis, snapshot) {
  const asset = document.getElementById('world-hero-asset'); if (!asset) return;
  asset.textContent = overviewState.symbol + ' / USDT';
  document.getElementById('world-hero-regime').textContent = environmentRegimeLabel(snapshot.code);
  document.getElementById('world-hero-copy').textContent = snapshot.copy;
  document.getElementById('world-hero-bias').textContent = analysis ? overviewState.symbol + ' · ' + analysis.verdict.title : overviewState.symbol + ' · контекст ещё загружается';
  const explanation = document.querySelector('.world-market-explanation'); explanation.dataset.regime = snapshot.code;
  explanation.querySelector('.world-toy').dataset.flow = snapshot.code === 'RISK ON' ? 'up' : snapshot.code === 'RISK OFF' ? 'down' : 'mixed';
  asset.dataset.available = String(Boolean(analysis));
  const calendarMissing = /unavailable|waiting/i.test(environmentState.source), demo = /demo/i.test(environmentState.source);
  if (calendarMissing) {
    document.getElementById('ov-macro-risk').textContent = 'Нет данных';
    document.getElementById('ov-next-event').textContent = 'Календарь недоступен · риск событий неизвестен';
    document.getElementById('ov-macro-risk').className = 'warn';
  } else if (demo) {
    document.getElementById('ov-next-event').textContent += ' · демо';
  }
}

function worldEventBucket(timestamp, now) {
  const diff = timestamp - now;
  return diff <= 15 * 60000 ? 0 : diff <= 6 * 3600000 ? 1 : 2;
}

function worldRenderEventTrack() {
  const list = document.getElementById('env-calendar-list'); if (!list || typeof environmentState === 'undefined') return;
  const now = Date.now(), source = environmentState.source, unavailable = /unavailable|waiting/i.test(source), demo = /demo/i.test(source);
  let events = environmentState.events.filter(event => Number.isFinite(event.timestamp) && event.timestamp >= now - 15 * 60000 && event.timestamp <= now + 48 * 3600000).sort((a, b) => a.timestamp - b.timestamp);
  if (environmentFilter === 'high') events = events.filter(event => event.impact === 'high');
  else if (environmentFilter === 'usd') events = events.filter(event => event.country === 'USD');
  const caption = document.getElementById('env-calendar-caption');
  if (caption) caption.textContent = unavailable ? 'Календарь недоступен · события неизвестны' : events.length + ' событий · ' + (demo ? 'Демо-данные' : source) + ' · время UTC';
  list.replaceChildren(); list.classList.add('world-event-track');
  if (unavailable) {
    const empty = worldElement('div', 'world-source-empty'); empty.append(worldToy('rock'), worldElement('span', null, 'Нет данных календаря. Отсутствие списка не означает отсутствие событий.')); list.append(empty);
    edgeSet('env-macro-risk', 'Нет данных', 'warn'); edgeSet('env-next-high', 'Риск событий неизвестен'); edgeSet('env-rail-event', 'Календарь недоступен');
    return;
  }
  const nextHigh = events.find(event => event.impact === 'high' && event.timestamp >= now - 10 * 60000);
  const shown = events.slice(0, 24);
  ['Сейчас · ±15 минут', 'Ближайшие часы · до 6ч', 'Позже · до 48ч'].forEach((label, index) => {
    const group = worldElement('section', 'world-event-stage'); group.dataset.stage = index;
    const heading = worldElement('h3'); heading.append(worldToy(index === 0 ? 'compass' : index === 1 ? 'beacon' : 'flag'), worldElement('span', null, label)); group.append(heading);
    const items = shown.filter(event => worldEventBucket(event.timestamp, now) === index);
    if (!items.length) group.append(worldElement('p', 'world-stage-empty', 'Событий для выбранного фильтра нет'));
    items.forEach(event => {
      const card = worldElement('article', 'world-event-card ' + event.impact); card.dataset.eventId = event.id;
      const isNext = nextHigh === event; card.classList.toggle('is-next-event', isNext);
      const top = worldElement('div', 'world-event-card-top');
      const time = worldElement('time', null, new Date(event.timestamp).toLocaleString('ru-RU', {timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' UTC'); time.dateTime = new Date(event.timestamp).toISOString();
      top.append(time, worldElement('span', 'world-event-impact', {high: 'Важное', medium: 'Среднее', low: 'Низкое'}[event.impact] || 'Низкое'));
      const name = worldElement('strong', 'world-event-name', event.country + ' · ' + event.title);
      const countdown = worldElement('div', 'world-event-countdown'); if (isNext) countdown.append(worldToy('beacon'));
      countdown.append(worldElement('span', null, (isNext ? 'Ближайшее важное · ' : '') + environmentEventCountdown(event.timestamp)));
      const values = worldElement('small', 'world-event-facts', [event.actual ? 'Факт ' + event.actual : event.forecast ? 'Прогноз ' + event.forecast : '', event.previous ? 'Пред. ' + event.previous : ''].filter(Boolean).join(' · ') || 'Значения пока не опубликованы');
      card.append(top, name, countdown, values); group.append(card);
    });
    list.append(group);
  });
  if (events.length > shown.length) list.append(worldElement('p', 'world-stage-empty', 'Показаны ближайшие 24 из ' + events.length + ' событий. Уточните фильтр.'));
}

function worldWatchReadings(result) {
  const finite = (value, digits, suffix = '') => Number.isFinite(value) ? value.toFixed(digits) + suffix : '—';
  return {signal: String(result.primary?.title || '—'), direction: {long: 'LONG', short: 'SHORT', neutral: 'Ждать'}[result.direction] || '—', score: finite(result.score, 0, '/100'), rsi: finite(result.inds?.['15m']?.rsi, 1), volume: finite(result.volumeRatio, 2, '×'), change: finite(result.changePct, 2, '%')};
}

function worldCaptureWatchChanges(results, at = Date.now()) {
  worldWatchChanges.clear(); worldWatchComparisonAt = at;
  for (const result of results) {
    if (result.error) {worldWatchChanges.set(result.symbol, {state: 'unavailable', changes: []}); continue;}
    const readings = worldWatchReadings(result), previous = worldWatchBaseline.get(result.symbol);
    const changes = previous ? Object.keys(readings).filter(key => readings[key] !== previous[key]).map(key => ({key, before: previous[key], after: readings[key]})) : [];
    worldWatchChanges.set(result.symbol, {state: previous ? changes.length ? 'changed' : 'unchanged' : 'baseline', changes});
    worldWatchBaseline.set(result.symbol, readings);
  }
  // A removed asset starts with a fresh baseline if it is added again.
  for (const symbol of worldWatchBaseline.keys()) if (!results.some(result => result.symbol === symbol)) worldWatchBaseline.delete(symbol);
}

function worldRenderWatchChanges() {
  const grid = document.getElementById('wt-signal-grid'); if (!grid) return;
  [...grid.querySelectorAll('.wt-signal-card')].forEach((card, index) => {
    const result = watchtowerFiltered()[index]; if (!result) return;
    card.querySelector('.world-watch-delta')?.remove();
    const delta = worldWatchChanges.get(result.symbol), section = worldElement('span', 'world-watch-delta');
    section.dataset.state = result.error ? 'unavailable' : delta?.state || 'baseline';
    if (section.dataset.state === 'changed') {
      const title = worldElement('strong', 'world-delta-title', 'Что изменилось'); title.prepend(worldToy('square')); section.append(title);
      delta.changes.forEach(change => {
        const row = worldElement('span', 'world-delta-row'); row.dataset.field = change.key;
        row.append(worldElement('small', null, {signal: 'Сигнал', direction: 'Направление', score: 'Контекст', rsi: 'RSI 15м', volume: 'Объём 15м', change: '24ч'}[change.key]), worldElement('span', 'world-delta-before', change.before), worldElement('span', 'world-delta-arrow', '→'), worldElement('strong', null, change.after));
        section.append(row);
      });
    } else section.textContent = {unavailable: 'Данные недоступны · сравнение пропущено', unchanged: 'Без изменений с предыдущего успешного измерения', baseline: 'Первое измерение · ждём следующий скан для сравнения'}[section.dataset.state];
    card.append(section);
  });
  const stamp = document.getElementById('wt-last-scan'); if (stamp) stamp.textContent = worldWatchComparisonAt ? new Date(worldWatchComparisonAt).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}) : '—';
  if (/unavailable|waiting/i.test(environmentState.source)) {battleSet('wt-event', 'Нет данных', 'warn'); battleSet('wt-event-copy', 'Календарь недоступен · риск событий неизвестен');}
}

document.addEventListener('DOMContentLoaded', worldInstallOrientation, {once: true});
