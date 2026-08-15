import { getCandles, getFearAndMarket, normalizeSymbol } from './public-market-bot.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.ETERNITY_CHANNEL_ID;
const CHAT_ID = process.env.ETERNITY_CHAT_ID;
const CHAT_THREAD_ID = process.env.ETERNITY_CHAT_THREAD_ID;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const MARKET_CONTEXT_URL = (process.env.MARKET_CONTEXT_URL || 'https://www.orbitum.trade').replace(/\/$/, '');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10_000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (value >= 100) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(5)}`;
}

function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) result = value * multiplier + result * (1 - multiplier);
  return result;
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].c;
    return Math.max(candle.h - candle.l, Math.abs(candle.h - previousClose), Math.abs(candle.l - previousClose));
  });
  return ranges.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function rsi(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const closes = candles.map((candle) => candle.c);
  const changes = closes.slice(1).map((value, index) => value - closes[index]);
  const recent = changes.slice(-period);
  const gains = recent.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses = recent.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}

function changePct(candles, periods) {
  if (!Array.isArray(candles) || candles.length < periods + 1) return null;
  const start = candles.at(-(periods + 1)).c;
  const end = candles.at(-1).c;
  return start ? ((end - start) / start) * 100 : null;
}

function priceStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 14) return { key: 'mixed', label: 'смешанная' };
  const previous = candles.slice(-14, -7);
  const recent = candles.slice(-7);
  const previousHigh = Math.max(...previous.map((candle) => candle.h));
  const previousLow = Math.min(...previous.map((candle) => candle.l));
  const recentHigh = Math.max(...recent.map((candle) => candle.h));
  const recentLow = Math.min(...recent.map((candle) => candle.l));
  if (recentHigh > previousHigh && recentLow > previousLow) return { key: 'bullish', label: 'повышающиеся максимумы и минимумы' };
  if (recentHigh < previousHigh && recentLow < previousLow) return { key: 'bearish', label: 'понижающиеся максимумы и минимумы' };
  return { key: 'mixed', label: 'смешанная: направленная последовательность не сформирована' };
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function analyzeCoin(symbol, fifteenMinuteCandles, hourlyCandles, dailyCandles, btcHourlyCandles = []) {
  if (fifteenMinuteCandles.length < 25 || hourlyCandles.length < 25 || dailyCandles.length < 20) {
    throw new Error('Недостаточно данных для анализа');
  }
  const price = hourlyCandles.at(-1).c;
  const hourlyCloses = hourlyCandles.map((candle) => candle.c);
  const dailyCloses = dailyCandles.map((candle) => candle.c);
  const fifteenCloses = fifteenMinuteCandles.map((candle) => candle.c);
  const ema20 = ema(hourlyCloses, 20);
  const ema50 = ema(hourlyCloses, 50);
  const dailyEma20 = ema(dailyCloses, 20);
  const dailyEma50 = ema(dailyCloses, 50);
  const fifteenEma20 = ema(fifteenCloses, 20);
  const previousDay = dailyCandles.at(-2);
  const atr14 = atr(dailyCandles, 14);
  const rsi14 = rsi(hourlyCandles, 14);
  const structure = priceStructure(hourlyCandles);
  const change24h = changePct(hourlyCandles, 24);
  const btcChange24h = btcHourlyCandles.length >= 25 ? changePct(btcHourlyCandles, 24) : null;
  const relativeStrength = Number.isFinite(btcChange24h) ? change24h - btcChange24h : null;
  const closed15m = fifteenMinuteCandles.at(-2);
  const priorVolumes = fifteenMinuteCandles.slice(-22, -2).map((candle) => candle.v);
  const averageVolume = average(priorVolumes);
  const volumeRatio = averageVolume > 0 ? closed15m.v / averageVolume : null;
  const volumeDirection = closed15m.c > closed15m.o ? 'покупки' : closed15m.c < closed15m.o ? 'продажи' : 'баланс';
  const shortHigh = Math.max(...fifteenMinuteCandles.slice(-20).map((candle) => candle.h));
  const shortLow = Math.min(...fifteenMinuteCandles.slice(-20).map((candle) => candle.l));
  const rangeSize = previousDay.h - previousDay.l;
  const rangePosition = rangeSize > 0 ? ((price - previousDay.l) / rangeSize) * 100 : null;

  let bullishScore = 0;
  let bearishScore = 0;
  const score = (condition, opposite) => {
    if (condition) bullishScore += 1;
    else if (opposite) bearishScore += 1;
  };
  score(price > ema20, price < ema20);
  score(ema50 && ema20 > ema50, ema50 && ema20 < ema50);
  score(price > dailyEma20, price < dailyEma20);
  score(dailyEma50 && dailyEma20 > dailyEma50, dailyEma50 && dailyEma20 < dailyEma50);
  score(price > fifteenEma20, price < fifteenEma20);
  score(rsi14 >= 55, rsi14 <= 45);
  score(structure.key === 'bullish', structure.key === 'bearish');
  score(change24h > 0, change24h < 0);
  const scoreDelta = bullishScore - bearishScore;
  const trend = scoreDelta >= 3
    ? { key: 'bullish', emoji: '🟢', label: 'преимущество покупателей' }
    : scoreDelta <= -3
      ? { key: 'bearish', emoji: '🔴', label: 'преимущество продавцов' }
      : { key: 'range', emoji: '⚪️', label: 'баланс / смешанный контекст' };
  const upperCandidates = [previousDay.h, shortHigh].filter((level) => level > price);
  const lowerCandidates = [previousDay.l, shortLow].filter((level) => level < price);
  const upTrigger = upperCandidates.length ? Math.min(...upperCandidates) : Math.max(previousDay.h, shortHigh);
  const downTrigger = lowerCandidates.length ? Math.max(...lowerCandidates) : Math.min(previousDay.l, shortLow);
  const atrValue = atr14 || price * 0.02;
  return {
    symbol,
    price,
    ema20,
    ema50,
    dailyEma20,
    dailyEma50,
    fifteenEma20,
    rsi14,
    atr14,
    atrPct: atr14 ? (atr14 / price) * 100 : null,
    change24h,
    btcChange24h,
    relativeStrength,
    volumeRatio,
    volumeDirection,
    structure,
    rangePosition,
    shortHigh,
    shortLow,
    bullishScore,
    bearishScore,
    previousHigh: previousDay.h,
    previousLow: previousDay.l,
    upTrigger,
    downTrigger,
    longTarget: upTrigger + atrValue * 0.75,
    shortTarget: downTrigger - atrValue * 0.75,
    trend,
  };
}

// Сохраняем совместимость со старыми внутренними вызовами, но публичное название — «Анализ».
export function analyzeScenario(symbol, hourlyCandles, dailyCandles) {
  return analyzeCoin(symbol, hourlyCandles, hourlyCandles, dailyCandles);
}

function rsiArgument(value) {
  if (value >= 70) return `RSI 1ч <b>${value.toFixed(1)}</b>: импульс сильный, но рынок перегрет — вход вслед за свечой повышает риск отката.`;
  if (value <= 30) return `RSI 1ч <b>${value.toFixed(1)}</b>: рынок перепродан — давление продавцов сильное, но возрастает риск резкого отскока.`;
  if (value >= 55) return `RSI 1ч <b>${value.toFixed(1)}</b>: импульс находится на стороне покупателей без экстремального перегрева.`;
  if (value <= 45) return `RSI 1ч <b>${value.toFixed(1)}</b>: импульс находится на стороне продавцов без экстремальной перепроданности.`;
  return `RSI 1ч <b>${value.toFixed(1)}</b>: импульс нейтральный и пока не подтверждает направленное движение.`;
}

function rangeArgument(position) {
  if (position > 100) return 'Цена уже выше максимума вчера: важнее удержание пробоя, чем сам факт выхода.';
  if (position < 0) return 'Цена уже ниже минимума вчера: продавцы контролируют выход, пока уровень не возвращён.';
  if (position >= 70) return `Цена находится в верхней части вчерашнего диапазона (${position.toFixed(0)}%): рядом предложение и зона проверки покупателей.`;
  if (position <= 30) return `Цена находится в нижней части вчерашнего диапазона (${position.toFixed(0)}%): рядом спрос и зона проверки продавцов.`;
  return `Цена находится в середине вчерашнего диапазона (${position.toFixed(0)}%): преимущество входа без реакции от границы ограничено.`;
}

export async function buildAnalysisMessage(symbolValue = 'BTC') {
  const symbol = normalizeSymbol(symbolValue);
  if (!symbol) throw new Error('Не понял тикер монеты');
  const [fifteen, hourly, daily, btcHourly, market] = await Promise.all([
    getCandles(symbol, '15m'),
    getCandles(symbol, '1h'),
    getCandles(symbol, '1d'),
    symbol === 'BTC' ? Promise.resolve(null) : getCandles('BTC', '1h'),
    getFearAndMarket(),
  ]);
  const analysis = analyzeCoin(symbol, fifteen.candles, hourly.candles, daily.candles, btcHourly?.candles || []);
  const hourlyPosition = analysis.price > analysis.ema20
    ? `выше EMA20 ${formatPrice(analysis.ema20)}`
    : `ниже EMA20 ${formatPrice(analysis.ema20)}`;
  const dailyPosition = analysis.price > analysis.dailyEma20
    ? `выше дневной EMA20 ${formatPrice(analysis.dailyEma20)}`
    : `ниже дневной EMA20 ${formatPrice(analysis.dailyEma20)}`;
  const volumeText = Number.isFinite(analysis.volumeRatio)
    ? `Объём закрытой 15м свечи — <b>${analysis.volumeRatio.toFixed(1)}× среднего</b>; направление свечи: ${analysis.volumeDirection}.`
    : 'Данные объёма сейчас недостаточны для подтверждения импульса.';
  const relativeText = Number.isFinite(analysis.relativeStrength)
    ? `${symbol} за 24ч ${analysis.relativeStrength >= 0 ? 'сильнее' : 'слабее'} BTC на <b>${Math.abs(analysis.relativeStrength).toFixed(2)} п.п.</b>`
    : null;
  const fearText = Number.isFinite(market.fearValue) ? `Настроение рынка · <b>${market.fearValue}/100</b>` : null;
  const biasText = analysis.trend.key === 'bullish'
    ? `Базовый приоритет — покупки после подтверждения. За рост ${analysis.bullishScore} факторов против ${analysis.bearishScore} медвежьих.`
    : analysis.trend.key === 'bearish'
      ? `Базовый приоритет — продажи после подтверждения. За снижение ${analysis.bearishScore} факторов против ${analysis.bullishScore} бычьих.`
      : `Явного преимущества нет: бычьих факторов ${analysis.bullishScore}, медвежьих ${analysis.bearishScore}. Рациональнее ждать выхода из диапазона.`;
  return (
    `👁 <b>EYE Eternity · Анализ ${escapeHtml(symbol)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 Цена · <b>${formatPrice(analysis.price)}</b> · ${formatPct(analysis.change24h)} за 24ч\n` +
    `${analysis.trend.emoji} Вывод · <b>${analysis.trend.label}</b>\n` +
    `📏 Волатильность · ATR <b>${formatPrice(analysis.atr14)}</b> (${formatPct(analysis.atrPct).replace('+', '')})\n` +
    [fearText, relativeText].filter(Boolean).join('\n') + `\n\n` +
    `🔎 <b>Что показывает рынок</b>\n` +
    `• 1D: цена ${dailyPosition}; среднесрочный контекст ${analysis.dailyEma50 && analysis.dailyEma20 > analysis.dailyEma50 ? 'положительный' : analysis.dailyEma50 && analysis.dailyEma20 < analysis.dailyEma50 ? 'отрицательный' : 'неопределённый'}.\n` +
    `• 1H: цена ${hourlyPosition}; структура — ${analysis.structure.label}.\n` +
    `• 15M: цена ${analysis.price > analysis.fifteenEma20 ? 'выше' : 'ниже'} EMA20 ${formatPrice(analysis.fifteenEma20)} — краткосрочный импульс ${analysis.price > analysis.fifteenEma20 ? 'поддерживает рост' : 'поддерживает снижение'}.\n` +
    `• ${rsiArgument(analysis.rsi14)}\n` +
    `• ${volumeText}\n` +
    `• ${rangeArgument(analysis.rangePosition)}\n\n` +
    `📍 <b>Ключевые уровни</b>\n` +
    `Верхняя граница / триггер · <b>${formatPrice(analysis.upTrigger)}</b>\n` +
    `Нижняя граница / триггер · <b>${formatPrice(analysis.downTrigger)}</b>\n` +
    `Диапазон вчера · ${formatPrice(analysis.previousLow)} — ${formatPrice(analysis.previousHigh)}\n\n` +
    `🟢 <b>Вариант роста</b>\n` +
    `Нужны закрытие выше <b>${formatPrice(analysis.upTrigger)}</b>, удержание уровня после возврата и объём не ниже среднего. Тогда пробой получает подтверждение, а следующая расчётная зона — <b>${formatPrice(analysis.longTarget)}</b>. Возврат и принятие цены ниже триггера отменят подтверждение.\n\n` +
    `🔴 <b>Вариант снижения</b>\n` +
    `Нужны закрытие ниже <b>${formatPrice(analysis.downTrigger)}</b>, слабый возврат к уровню и сохранение продавца на объёме. Тогда следующая расчётная зона — <b>${formatPrice(analysis.shortTarget)}</b>. Возврат выше триггера отменит подтверждение.\n\n` +
    `⚖️ <b>Итог</b>\n${biasText}\n\n` +
    `<i>Анализ описывает текущие данные и условия подтверждения, а не является командой на вход.</i>`
  );
}

export const buildScenarioMessage = buildAnalysisMessage;

function translateEventTitle(title) {
  const value = String(title || 'Экономическое событие');
  const normalized = value.toLowerCase();
  const map = [
    [/nonfarm|non-farm|nfp/, 'Количество занятых вне сельского хозяйства (NFP)'],
    [/consumer price|\bcpi\b/, 'Индекс потребительских цен (CPI)'],
    [/producer price|\bppi\b/, 'Индекс цен производителей (PPI)'],
    [/fomc.*rate|federal funds rate|interest rate decision/, 'Решение ФРС по ставке'],
    [/fomc.*minute/, 'Протокол заседания FOMC'],
    [/powell/, 'Выступление главы ФРС Пауэлла'],
    [/gross domestic product|\bgdp\b/, 'ВВП США'],
    [/unemployment rate/, 'Уровень безработицы в США'],
    [/jobless claims|unemployment claims/, 'Заявки на пособие по безработице'],
    [/retail sales/, 'Розничные продажи в США'],
    [/\bpce\b|personal consumption expenditures/, 'Индекс расходов на личное потребление (PCE)'],
  ];
  return map.find(([pattern]) => pattern.test(normalized))?.[1] || value;
}

function formatEventTime(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(Number(timestamp)));
}

export async function getEconomicEvents(now = new Date(), days = 1) {
  const from = dateKey(now);
  const toDate = new Date(now.getTime() + Math.max(0, days - 1) * 86_400_000);
  const to = dateKey(toDate);
  const response = await fetch(`${MARKET_CONTEXT_URL}/api/finnhub?type=calendar&from=${from}&to=${to}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'EYE-Eternity-Monitor/1.0' },
    signal: AbortSignal.timeout(9_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Календарь: HTTP ${response.status}`);
  return (Array.isArray(payload.events) ? payload.events : [])
    .filter((event) => Number.isFinite(Number(event.timestamp)))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

export async function buildCalendarMessage(now = new Date()) {
  const events = await getEconomicEvents(now, 2);
  const important = events
    .filter((event) => ['high', 'medium'].includes(event.impact))
    .filter((event) => ['USD', 'US', '—'].includes(String(event.country || '').toUpperCase()))
    .slice(0, 12);
  const lines = important.map((event) => {
    const marker = event.impact === 'high' ? '🔴' : '🟠';
    const details = [event.forecast && `прогноз ${event.forecast}`, event.previous && `пред. ${event.previous}`].filter(Boolean).join(' · ');
    return `${marker} <b>${formatEventTime(event.timestamp)} МСК</b> · ${escapeHtml(translateEventTitle(event.title))}${details ? `\n   <i>${escapeHtml(details)}</i>` : ''}`;
  });
  return (
    `👁 <b>EYE Eternity · Экономический календарь</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    (lines.length ? lines.join('\n\n') : '✅ Значимых событий по США на ближайшие два дня не найдено.') +
    `\n\n<i>Перед красными событиями учитывайте расширение спреда, проскальзывание и ложные движения.</i>`
  );
}

export function getSessionWarning(now = new Date()) {
  const sessions = [
    {
      id: 'asia', timeZone: 'Asia/Tokyo', hour: 8, minute: 55,
      title: 'Азиатская сессия начнётся через 5 минут', emoji: '🌏',
      text: 'В начале сессии рынок часто формирует диапазон. Не догоняйте первый импульс; отметьте ночные максимум и минимум и дождитесь реакции цены.',
    },
    {
      id: 'london', timeZone: 'Europe/London', hour: 7, minute: 55,
      title: 'Лондонская сессия начнётся через 5 минут', emoji: '🇬🇧',
      text: 'Отметьте границы Азии. Первый выход из диапазона может оказаться сбором ликвидности — вход имеет смысл оценивать после закрепления или возврата к уровню.',
    },
    {
      id: 'new-york', timeZone: 'America/New_York', hour: 7, minute: 55,
      title: 'Нью-Йоркская сессия начнётся через 5 минут', emoji: '🇺🇸',
      text: 'Проверьте экономический календарь и границы Лондона. Не открывайте позицию в середине импульса; дождитесь реакции после открытия американского потока.',
    },
  ];
  return sessions.find((session) => {
    const parts = zonedParts(now, session.timeZone);
    return Number(parts.hour) === session.hour && Number(parts.minute) >= session.minute;
  }) || null;
}

export function shouldWarnEvent(event, now = new Date()) {
  const minutes = (Number(event.timestamp) - now.getTime()) / 60_000;
  return ['high', 'medium'].includes(event.impact) &&
    ['USD', 'US', '—'].includes(String(event.country || '').toUpperCase()) &&
    minutes >= 25 && minutes <= 35;
}

async function claimAlert(alertKey, payload = {}) {
  if (!SB_URL || !SB_KEY) throw new Error('Supabase не настроен для защиты от повторных уведомлений');
  const response = await fetch(`${SB_URL}/rest/v1/eye_market_alert_state?on_conflict=alert_key`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({ alert_key: alertKey, payload }),
    signal: AbortSignal.timeout(7_000),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Supabase: HTTP ${response.status}`);
  return Array.isArray(rows) && rows.length > 0;
}

async function releaseAlert(alertKey) {
  await fetch(`${SB_URL}/rest/v1/eye_market_alert_state?alert_key=eq.${encodeURIComponent(alertKey)}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

async function tgSendTo(chatId, text, messageThreadId = null) {
  if (!BOT_TOKEN) throw new Error('Telegram-бот для уведомлений не настроен');
  const send = async (targetChatId) => {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(messageThreadId ? { message_thread_id: Number(messageThreadId) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };
  let { response, payload } = await send(chatId);
  const migratedChatId = payload?.parameters?.migrate_to_chat_id;
  if ((!response.ok || !payload.ok) && migratedChatId) ({ response, payload } = await send(migratedChatId));
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram: HTTP ${response.status}`);
  return payload.result?.message_id;
}

async function sendOnce(alertKey, text, payload = {}) {
  const targets = [
    CHANNEL_ID ? { id: String(CHANNEL_ID), kind: 'channel', threadId: null } : null,
    CHAT_ID && String(CHAT_ID) !== String(CHANNEL_ID)
      ? { id: String(CHAT_ID), kind: 'chat', threadId: CHAT_THREAD_ID }
      : null,
  ].filter(Boolean);
  if (!targets.length) throw new Error('Канал или чат для уведомлений не настроен');

  const deliveries = [];
  for (const target of targets) {
    const deliveryKey = `${alertKey}:${target.kind}:${target.id}`;
    const claimed = await claimAlert(deliveryKey, { ...payload, target: target.kind });
    if (!claimed) {
      deliveries.push({ target: target.kind, sent: false, reason: 'duplicate' });
      continue;
    }
    try {
      const messageId = await tgSendTo(target.id, text, target.threadId);
      deliveries.push({ target: target.kind, sent: true, messageId });
    } catch (error) {
      await releaseAlert(deliveryKey);
      throw error;
    }
  }
  return { sent: deliveries.some((delivery) => delivery.sent), alertKey, deliveries };
}

function buildEventWarning(events) {
  const time = formatEventTime(events[0].timestamp);
  const lines = events.map((event) => {
    const marker = event.impact === 'high' ? '🔴' : '🟠';
    return `${marker} ${escapeHtml(translateEventTitle(event.title))}`;
  }).join('\n');
  return (
    `⚠️ <b>Событие через 30 минут · ${time} МСК</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n${lines}\n\n` +
    `До публикации:\n` +
    `• не увеличивайте риск;\n` +
    `• учитывайте расширение спреда и проскальзывание;\n` +
    `• новый вход лучше оценивать после первой реакции и возврата ликвидности.\n\n` +
    `<i>Резкий первый импульс после новости не подтверждает направление сам по себе.</i>`
  );
}

async function monitorEvents(now, results) {
  const events = await getEconomicEvents(now, 2);
  const due = events.filter((event) => shouldWarnEvent(event, now));
  const groups = new Map();
  for (const event of due) {
    const key = String(event.timestamp);
    groups.set(key, [...(groups.get(key) || []), event]);
  }
  for (const [timestamp, group] of groups) {
    results.push(await sendOnce(`event:${timestamp}`, buildEventWarning(group), { events: group.map((event) => event.id) }));
  }
}

async function monitorSession(now, results) {
  const session = getSessionWarning(now);
  if (!session) return;
  const local = zonedParts(now, session.timeZone);
  const key = `session:${session.id}:${local.year}-${local.month}-${local.day}`;
  results.push(await sendOnce(key,
    `${session.emoji} <b>${session.title}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${session.text}\n\n<i>Главная задача на открытии — увидеть реакцию, а не угадать первый рывок.</i>`,
    { session: session.id },
  ));
}

async function monitorBitcoin(now, results) {
  const [fiveMinute, daily] = await Promise.all([getCandles('BTC', '5m'), getCandles('BTC', '1d')]);
  const closed = fiveMinute.candles.at(-2);
  const before = fiveMinute.candles.at(-3);
  const volumeWindow = fiveMinute.candles.slice(-23, -3);
  const averageVolume = volumeWindow.reduce((sum, candle) => sum + candle.v, 0) / Math.max(1, volumeWindow.length);
  const volumeRatio = averageVolume > 0 ? closed.v / averageVolume : 0;
  const candleChange = ((closed.c - closed.o) / closed.o) * 100;
  if (volumeRatio >= 3 && Math.abs(candleChange) >= 0.15) {
    const direction = candleChange >= 0 ? 'роста' : 'снижения';
    results.push(await sendOnce(`btc-volume:${closed.x}`,
      `🔥 <b>Аномальный объём BTC</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Объём 5-минутной свечи · <b>${volumeRatio.toFixed(1)}× среднего</b>\n` +
      `Изменение цены · <b>${formatPct(candleChange)}</b>\n` +
      `Текущая цена · <b>${formatPrice(closed.c)}</b>\n\n` +
      `Рынок получил импульс ${direction}. Не догоняйте свечу: дождитесь закрытия следующего интервала и проверьте, удерживается ли пробитый уровень.`,
      { candle: closed.x, volumeRatio },
    ));
  }

  const previousDay = daily.candles.at(-2);
  const day = dateKey(now);
  if (closed.c > previousDay.h && before.c <= previousDay.h) {
    results.push(await sendOnce(`btc-range:${day}:up`,
      `📍 <b>BTC вышел выше дневного диапазона</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Максимум вчера · <b>${formatPrice(previousDay.h)}</b>\n` +
      `Цена закрытия 5м · <b>${formatPrice(closed.c)}</b>\n\n` +
      `Теперь важен не сам прокол, а удержание уровня после возврата. Возврат под максимум вчера отменит подтверждение выхода.`,
      { level: previousDay.h, close: closed.c },
    ));
  }
  if (closed.c < previousDay.l && before.c >= previousDay.l) {
    results.push(await sendOnce(`btc-range:${day}:down`,
      `📍 <b>BTC вышел ниже дневного диапазона</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Минимум вчера · <b>${formatPrice(previousDay.l)}</b>\n` +
      `Цена закрытия 5м · <b>${formatPrice(closed.c)}</b>\n\n` +
      `Следите за принятием цены ниже уровня. Быстрый возврат выше минимума вчера укажет на ложный выход.`,
      { level: previousDay.l, close: closed.c },
    ));
  }
}

async function monitorEvening(now, results) {
  const moscow = zonedParts(now, 'Europe/Moscow');
  if (Number(moscow.hour) !== 20 || Number(moscow.minute) > 4) return;
  const [daily, market] = await Promise.all([getCandles('BTC', '1d'), getFearAndMarket()]);
  const current = daily.candles.at(-1);
  const previous = daily.candles.at(-2);
  const change = ((current.c - current.o) / current.o) * 100;
  const position = current.c > previous.h
    ? 'день проходит выше максимума вчера'
    : current.c < previous.l
      ? 'день проходит ниже минимума вчера'
      : 'цена осталась внутри вчерашнего диапазона';
  results.push(await sendOnce(`evening:${moscow.year}-${moscow.month}-${moscow.day}`,
    `📊 <b>EYE Eternity · Итоги дня</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `₿ BTC · <b>${formatPrice(current.c)}</b> · ${formatPct(change)}\n` +
    `Диапазон дня · ${formatPrice(current.l)} — ${formatPrice(current.h)}\n` +
    `Структура · <b>${position}</b>\n` +
    `Доминация BTC · <b>${Number.isFinite(market.btcDominance) ? `${market.btcDominance.toFixed(1)}%` : '—'}</b>\n` +
    `Настроение · <b>${Number.isFinite(market.fearValue) ? `${market.fearValue}/100` : '—'}</b>\n\n` +
    `Перед следующей сессией зафиксируйте: где рынок принял цену, какие уровни только проколол и где сценарий дня перестал работать.`,
    { close: current.c, change },
  ));
}

export async function runMarketMonitor(now = new Date()) {
  const results = [];
  const checks = await Promise.allSettled([
    monitorSession(now, results),
    monitorEvents(now, results),
    monitorBitcoin(now, results),
    monitorEvening(now, results),
  ]);
  const errors = checks
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || 'Неизвестная ошибка');
  return { ok: errors.length === 0, checkedAt: now.toISOString(), results, errors };
}
