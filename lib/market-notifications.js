import { getCandles, getFearAndMarket, normalizeSymbol } from './public-market-bot.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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

export function analyzeScenario(symbol, hourlyCandles, dailyCandles) {
  if (hourlyCandles.length < 25 || dailyCandles.length < 20) throw new Error('Недостаточно данных для сценария');
  const price = hourlyCandles.at(-1).c;
  const closes = hourlyCandles.map((candle) => candle.c);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const previousDay = dailyCandles.at(-2);
  const atr14 = atr(dailyCandles, 14);
  const rsi14 = rsi(hourlyCandles, 14);
  const trend = price > ema20 && (!ema50 || ema20 > ema50)
    ? { key: 'bullish', emoji: '🟢', label: 'восходящий' }
    : price < ema20 && (!ema50 || ema20 < ema50)
      ? { key: 'bearish', emoji: '🔴', label: 'нисходящий' }
      : { key: 'range', emoji: '⚪️', label: 'смешанный / диапазон' };
  return {
    symbol,
    price,
    ema20,
    ema50,
    rsi14,
    atr14,
    previousHigh: previousDay.h,
    previousLow: previousDay.l,
    longTarget: previousDay.h + (atr14 || price * 0.02),
    shortTarget: previousDay.l - (atr14 || price * 0.02),
    trend,
  };
}

export async function buildScenarioMessage(symbolValue = 'BTC') {
  const symbol = normalizeSymbol(symbolValue);
  if (!symbol) throw new Error('Не понял тикер монеты');
  const [hourly, daily] = await Promise.all([getCandles(symbol, '1h'), getCandles(symbol, '1d')]);
  const scenario = analyzeScenario(symbol, hourly.candles, daily.candles);
  const rsiLabel = scenario.rsi14 >= 70 ? 'перегрет' : scenario.rsi14 <= 30 ? 'перепродан' : 'нейтральный';
  const neutralText = scenario.trend.key === 'range'
    ? 'Цена находится в смешанном контексте. Работа внутри диапазона требует подтверждения от его границ.'
    : `Приоритет сохраняется в сторону ${scenario.trend.key === 'bullish' ? 'роста' : 'снижения'}, пока цена удерживает структуру относительно EMA 20/50.`;
  return (
    `👁 <b>EYE Eternity · Сценарий ${escapeHtml(symbol)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 Цена · <b>${formatPrice(scenario.price)}</b>\n` +
    `${scenario.trend.emoji} Контекст · <b>${scenario.trend.label}</b>\n` +
    `📐 RSI 14 · <b>${scenario.rsi14.toFixed(1)}</b> · ${rsiLabel}\n` +
    `📏 ATR дня · <b>${formatPrice(scenario.atr14)}</b>\n\n` +
    `🟢 <b>Сценарий вверх</b>\n` +
    `Закрепление выше <b>${formatPrice(scenario.previousHigh)}</b> и удержание уровня после возврата. Следующая зона внимания — <b>${formatPrice(scenario.longTarget)}</b>.\n\n` +
    `🔴 <b>Сценарий вниз</b>\n` +
    `Принятие цены ниже <b>${formatPrice(scenario.previousLow)}</b>. Следующая зона внимания — <b>${formatPrice(scenario.shortTarget)}</b>.\n\n` +
    `⚪️ <b>Пока цена внутри диапазона</b>\n` +
    `${neutralText}\n\n` +
    `<i>Сценарий описывает условия реакции, а не является командой на вход.</i>`
  );
}

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

async function tgSend(text) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error('Telegram-чат для уведомлений не настроен');
  const send = async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(CHAT_THREAD_ID ? { message_thread_id: Number(CHAT_THREAD_ID) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };
  let { response, payload } = await send(CHAT_ID);
  const migratedChatId = payload?.parameters?.migrate_to_chat_id;
  if ((!response.ok || !payload.ok) && migratedChatId) ({ response, payload } = await send(migratedChatId));
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram: HTTP ${response.status}`);
  return payload.result?.message_id;
}

async function sendOnce(alertKey, text, payload = {}) {
  const claimed = await claimAlert(alertKey, payload);
  if (!claimed) return { sent: false, reason: 'duplicate', alertKey };
  try {
    const messageId = await tgSend(text);
    return { sent: true, alertKey, messageId };
  } catch (error) {
    await releaseAlert(alertKey);
    throw error;
  }
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
