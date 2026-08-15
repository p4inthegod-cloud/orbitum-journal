import { createHash, timingSafeEqual } from 'node:crypto';
import { handleLead } from '../lib/lead-handler.js';
import { publishMarketDaily } from '../lib/market-daily-runtime.js';
import {
  buildChartCaption,
  getCandles,
  getFearAndMarket,
  getMarketLeaders,
  getTradingSession,
  normalizeSymbol,
  normalizeTimeframe,
  renderChartPng,
  summarizeCandles,
  TIMEFRAMES,
} from '../lib/public-market-bot.js';
import { buildCalendarMessage, buildScenarioMessage, runMarketMonitor } from '../lib/market-notifications.js';
import { escapeHtml, formatP2PMessage, P2P_WALLET_URL, scanWalletP2P } from '../lib/p2p-scanner.js';

// EYE Eternity — публичный Telegram-бот с рыночной аналитикой.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const P2P_DEDUPE = globalThis.__eyeEternityP2PDedupe || new Map();
const COMMAND_COOLDOWN = globalThis.__eyeEternityCommandCooldown || new Map();
const MONITOR_KEY_HASH = 'ca32c8a1463bada10f7a5361d42c776effc536bece5f374aeb2ccf52bb7a0c0b';
globalThis.__eyeEternityP2PDedupe = P2P_DEDUPE;
globalThis.__eyeEternityCommandCooldown = COMMAND_COOLDOWN;

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Открыть меню EYE Eternity' },
  { command: 'market', description: 'Полный обзор рынка и BTC' },
  { command: 'chart', description: 'График монеты: /chart BTC 15m' },
  { command: 'btc', description: 'График BTC' },
  { command: 'eth', description: 'График ETH' },
  { command: 'sol', description: 'График SOL' },
  { command: 'price', description: 'Цена монеты: /price BTC' },
  { command: 'fear', description: 'Настроение и доминация BTC' },
  { command: 'top', description: 'Лидеры роста и падения' },
  { command: 'session', description: 'Текущая торговая сессия' },
  { command: 'scenario', description: 'Сценарии монеты: /scenario BTC' },
  { command: 'calendar', description: 'Экономические события' },
  { command: 'help', description: 'Все публичные команды' },
];

function kb(...rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function cbBtn(text, data) {
  return { text, callback_data: data };
}

async function telegramRequest(method, payload, { timeout = 12_000 } = {}) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function tgSend(chatId, text, extra = {}) {
  try {
    let { response, data } = await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
    const migratedChatId = data?.parameters?.migrate_to_chat_id;
    if ((!response.ok || !data.ok) && migratedChatId) {
      console.log(`[bot] повторная отправка в супергруппу ${chatId} -> ${migratedChatId}`);
      ({ response, data } = await telegramRequest('sendMessage', {
        chat_id: migratedChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
      }));
    }
    if (!response.ok || !data.ok) console.warn('[bot] отправка сообщения', JSON.stringify(data));
    return response.ok && data.ok;
  } catch (error) {
    console.error('[bot] отправка сообщения', error.message);
    return false;
  }
}

async function tgPhoto(chatId, image, caption, extra = {}) {
  const send = async (targetChatId) => {
    const form = new FormData();
    form.append('chat_id', String(targetChatId));
    form.append('photo', new Blob([image], { type: 'image/png' }), 'eye-eternity-chart.png');
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(18_000),
    });
    return { response, data: await response.json().catch(() => ({})) };
  };

  try {
    let { response, data } = await send(chatId);
    const migratedChatId = data?.parameters?.migrate_to_chat_id;
    if ((!response.ok || !data.ok) && migratedChatId) {
      ({ response, data } = await send(migratedChatId));
    }
    if (!response.ok || !data.ok) console.warn('[bot] отправка графика', JSON.stringify(data));
    return response.ok && data.ok;
  } catch (error) {
    console.error('[bot] отправка графика', error.message);
    return false;
  }
}

function answerCallback(id) {
  telegramRequest('answerCallbackQuery', { callback_query_id: id }, { timeout: 5_000 }).catch(() => {});
}

function sendAction(chatId, action = 'typing') {
  telegramRequest('sendChatAction', { chat_id: chatId, action }, { timeout: 5_000 }).catch(() => {});
}

async function setBotCommands() {
  if (!BOT_TOKEN) return false;
  const privateResult = await telegramRequest('setMyCommands', {
    commands: PUBLIC_COMMANDS,
    scope: { type: 'all_private_chats' },
    language_code: 'ru',
  });
  const groupResult = await telegramRequest('setMyCommands', {
    commands: PUBLIC_COMMANDS,
    scope: { type: 'all_group_chats' },
    language_code: 'ru',
  });
  if (!privateResult.response.ok || !privateResult.data.ok || !groupResult.response.ok || !groupResult.data.ok) {
    throw new Error(privateResult.data.description || groupResult.data.description || 'Telegram не принял список команд');
  }
  return true;
}

function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  return bearer === secret || req.headers?.['x-cron-secret'] === secret || req.query?.secret === secret;
}

function isMonitorAuthorized(req) {
  const supplied = String(req.headers?.['x-monitor-key'] || '');
  if (!supplied) return false;
  const actual = Buffer.from(createHash('sha256').update(supplied).digest('hex'));
  const expected = Buffer.from(MONITOR_KEY_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function handleMarketMonitor(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Метод не поддерживается' });
  if (!isMonitorAuthorized(req)) return res.status(401).json({ error: 'Нет доступа' });
  try {
    const result = await runMarketMonitor();
    console.log('[market-monitor]', JSON.stringify(result));
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    console.error('[market-monitor]', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleTelegramHealth(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Метод не поддерживается' });
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Нет доступа' });
  if (!BOT_TOKEN) return res.status(503).json({ error: 'Токен Telegram не настроен' });
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || 'https://www.orbitum.trade/api/bot';

  try {
    const api = async (method, payload) => {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(`${method}: ${data.description || `HTTP ${response.status}`}`);
      return data.result;
    };
    const bot = await api('getMe');
    const previous = await api('getWebhookInfo');
    const needsUpdate = previous.url !== webhookUrl;
    if (needsUpdate) {
      await api('setWebhook', { url: webhookUrl, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
    }
    await setBotCommands();
    const current = needsUpdate ? await api('getWebhookInfo') : previous;
    console.log(`[bot:webhook] @${bot.username} current=${current.url || '-'} updated=${needsUpdate}`);
    return res.status(200).json({
      ok: true,
      username: bot.username,
      webhookUrl: current.url,
      commandsUpdated: true,
      pendingUpdateCount: current.pending_update_count || 0,
      lastErrorMessage: current.last_error_message || null,
    });
  } catch (error) {
    console.error('[bot:webhook]', error);
    return res.status(502).json({ error: error.message });
  }
}

async function handleP2PCron(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Метод не поддерживается' });
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Нет доступа' });
  const chatId = process.env.P2P_CHAT_ID;
  if (!BOT_TOKEN || !chatId) return res.status(503).json({ error: 'P2P-сканер не настроен' });
  try {
    const scan = await scanWalletP2P();
    const best = scan.qualifying[0];
    if (!best) {
      return res.status(200).json({ ok: true, notified: false, scanned: scan.scanned, eligible: scan.offers.length, bestDiscountPct: scan.best?.discountPct ?? null });
    }
    const configuredRepeat = Number(process.env.P2P_REPEAT_MINUTES || 30);
    const repeatMinutes = Number.isFinite(configuredRepeat) ? Math.max(5, configuredRepeat) : 30;
    const fingerprint = `${best.id}:${best.price}`;
    const lastSentAt = P2P_DEDUPE.get(fingerprint) || 0;
    if (Date.now() - lastSentAt < repeatMinutes * 60_000) {
      return res.status(200).json({ ok: true, notified: false, reason: 'duplicate', adId: best.id });
    }
    const sent = await tgSend(chatId, formatP2PMessage({ ...scan, best }, { automatic: true }), {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Wallet', url: P2P_WALLET_URL }]] },
    });
    if (!sent) throw new Error('Telegram не принял сообщение');
    P2P_DEDUPE.clear();
    P2P_DEDUPE.set(fingerprint, Date.now());
    return res.status(200).json({ ok: true, notified: true, adId: best.id, price: best.price });
  } catch (error) {
    console.error('[bot:p2p-cron]', error);
    return res.status(500).json({ error: error.message });
  }
}

function menuKeyboard() {
  return kb(
    [cbBtn('📊 Обзор рынка', 'public:market'), cbBtn('₿ График BTC', 'chart:BTC:1h')],
    [cbBtn('Ξ График ETH', 'chart:ETH:1h'), cbBtn('◎ График SOL', 'chart:SOL:1h')],
    [cbBtn('😨 Настроение', 'public:fear'), cbBtn('🔥 Лидеры рынка', 'public:top')],
    [cbBtn('🧭 Сценарий BTC', 'public:scenario:BTC'), cbBtn('🗓 Календарь', 'public:calendar')],
  );
}

function timeframeKeyboard(symbol) {
  return kb(Object.keys(TIMEFRAMES).map((timeframe) => cbBtn(timeframe, `chart:${symbol}:${timeframe}`)));
}

function helpText() {
  return (
    `👁 <b>EYE Eternity</b>\n` +
    `<i>Рыночная аналитика и графики прямо в Telegram.</i>\n\n` +
    `📊 <b>Рынок</b>\n` +
    `/market — полный обзор рынка и BTC\n` +
    `/fear — настроение рынка и доминация BTC\n` +
    `/top — лидеры роста и падения за 24 часа\n` +
    `/session — текущая торговая сессия\n\n` +
    `🧭 <b>План и события</b>\n` +
    `/scenario BTC — сценарии вверх, вниз и внутри диапазона\n` +
    `/calendar — важные события сегодня и завтра\n\n` +
    `📈 <b>Монеты</b>\n` +
    `/chart BTC 15m — свечной график монеты\n` +
    `/price ETH — цена и диапазон монеты\n` +
    `/btc 4h · /eth 1h · /sol 15m — быстрые графики\n\n` +
    `⏱ <b>Таймфреймы:</b> 5m · 15m · 1h · 4h · 1d\n\n` +
    `<i>Данные носят информационный характер и не являются торговой рекомендацией.</i>`
  );
}

function cooldownExceeded(userId, action, seconds) {
  const key = `${userId || 'unknown'}:${action}`;
  const now = Date.now();
  const last = COMMAND_COOLDOWN.get(key) || 0;
  if (now - last < seconds * 1000) return true;
  COMMAND_COOLDOWN.set(key, now);
  if (COMMAND_COOLDOWN.size > 1_000) COMMAND_COOLDOWN.clear();
  return false;
}

async function sendChart(chatId, symbolValue, timeframeValue) {
  const symbol = normalizeSymbol(symbolValue);
  const timeframe = normalizeTimeframe(timeframeValue || '1h');
  if (!symbol) {
    await tgSend(chatId, '⚠️ Не понял тикер монеты. Пример: <code>/chart BTC 15m</code>');
    return;
  }
  if (!timeframe) {
    await tgSend(chatId, '⚠️ Доступные таймфреймы: <b>5m · 15m · 1h · 4h · 1d</b>');
    return;
  }
  sendAction(chatId, 'upload_photo');
  const { candles, source } = await getCandles(symbol, timeframe);
  const image = await renderChartPng(symbol, timeframe, candles);
  await tgPhoto(chatId, image, buildChartCaption(symbol, timeframe, candles, source), timeframeKeyboard(symbol));
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)} трлн`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)} млрд`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fearLabelRu(value) {
  if (!Number.isFinite(value)) return 'нет данных';
  if (value <= 24) return 'крайний страх';
  if (value <= 44) return 'страх';
  if (value <= 55) return 'нейтрально';
  if (value <= 74) return 'жадность';
  return 'крайняя жадность';
}

async function sendFear(chatId) {
  sendAction(chatId);
  const market = await getFearAndMarket();
  const change = market.marketChangePct;
  await tgSend(chatId,
    `👁 <b>EYE Eternity · Настроение рынка</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🌡 Индекс страха и жадности · <b>${Number.isFinite(market.fearValue) ? `${market.fearValue}/100` : '—'}</b>\n` +
    `Состояние · <b>${fearLabelRu(market.fearValue)}</b>\n\n` +
    `₿ Доминация BTC · <b>${Number.isFinite(market.btcDominance) ? `${market.btcDominance.toFixed(1)}%` : '—'}</b>\n` +
    `💰 Капитализация · <b>${formatMoney(market.marketCap)}</b>\n` +
    `📈 Изменение за 24ч · <b>${Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}</b>\n\n` +
    `<i>Высокая жадность повышает риск перегретых входов, высокий страх — риск импульсивных продаж.</i>`
  );
}

async function sendTop(chatId) {
  sendAction(chatId);
  const { gainers, losers } = await getMarketLeaders();
  const row = (coin) => `${escapeHtml(coin.symbol.toUpperCase())} · <b>${coin.price_change_percentage_24h >= 0 ? '+' : ''}${coin.price_change_percentage_24h.toFixed(2)}%</b>`;
  await tgSend(chatId,
    `👁 <b>EYE Eternity · Движение рынка за 24ч</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🟢 <b>Лидеры роста</b>\n${gainers.map(row).join('\n') || 'Нет данных'}\n\n` +
    `🔴 <b>Лидеры падения</b>\n${losers.map(row).join('\n') || 'Нет данных'}\n\n` +
    `<i>Выборка: 50 крупнейших активов по капитализации.</i>`
  );
}

async function sendPrice(chatId, symbolValue) {
  const symbol = normalizeSymbol(symbolValue);
  if (!symbol) {
    await tgSend(chatId, '⚠️ Укажите монету. Пример: <code>/price BTC</code>');
    return;
  }
  sendAction(chatId);
  const { candles, source } = await getCandles(symbol, '1h');
  const summary = summarizeCandles(candles.slice(-24));
  await tgSend(chatId,
    `👁 <b>EYE Eternity · ${escapeHtml(symbol)}/USDT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 Цена · <b>$${summary.price.toLocaleString('en-US', { maximumFractionDigits: 8 })}</b>\n` +
    `${summary.changePct >= 0 ? '🟢' : '🔴'} Изменение за 24ч · <b>${summary.changePct >= 0 ? '+' : ''}${summary.changePct.toFixed(2)}%</b>\n` +
    `↕️ Диапазон за 24ч · <b>$${summary.low.toLocaleString('en-US', { maximumFractionDigits: 8 })} — $${summary.high.toLocaleString('en-US', { maximumFractionDigits: 8 })}</b>\n\n` +
    `<i>Источник котировок: ${escapeHtml(source)}.</i>`,
    timeframeKeyboard(symbol),
  );
}

async function sendSession(chatId) {
  const session = getTradingSession();
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  await tgSend(chatId,
    `👁 <b>EYE Eternity · Торговая сессия</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${session.emoji} Сейчас · <b>${session.name}</b>\n` +
    `🕒 Время · <b>${time} МСК</b>\n\n` +
    `${escapeHtml(session.note)}\n\n` +
    `<i>Оценивайте не название сессии, а фактический объём и реакцию цены на ключевые уровни.</i>`
  );
}

async function handlePrivateP2P(chatId, text) {
  const amountArg = text.split(/\s+/)[1];
  const requestedAmount = amountArg ? Number(amountArg.replace(',', '.')) : undefined;
  if (amountArg && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
    await tgSend(chatId, 'Формат: <code>/p2p 5000</code>');
    return;
  }
  await tgSend(chatId, '⏳ Сканирую Wallet P2P…');
  try {
    const scan = await scanWalletP2P(requestedAmount ? { fiatAmount: requestedAmount } : {});
    await tgSend(chatId, formatP2PMessage(scan), {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Wallet', url: P2P_WALLET_URL }]] },
    });
  } catch (error) {
    console.error('[bot:p2p]', error);
    await tgSend(chatId, `⚠️ Не удалось проверить P2P: <code>${escapeHtml(String(error.message).slice(0, 180))}</code>`);
  }
}

export default async function handler(req, res) {
  if (req.query?.action === 'market-monitor') return handleMarketMonitor(req, res);
  if (req.query?.action === 'telegram-health') return handleTelegramHealth(req, res);
  if (req.query?.action === 'p2p-cron') return handleP2PCron(req, res);
  if (req.query?.action === 'lead') return handleLead(req, res);
  if (req.method !== 'POST') return res.status(200).send('EYE Eternity');

  try {
    const body = req.body || {};
    const callback = body.callback_query;
    const msg = body.message || callback?.message;
    if (!msg) return res.status(200).send('OK');
    const chatId = msg.chat.id;
    const from = body.message?.from || callback?.from || {};
    const text = String(body.message?.text || '').trim();
    const callbackData = String(callback?.data || '');
    const input = callbackData || text;
    const command = input.startsWith('/')
      ? input.replace(/^\/([a-z0-9_]+)@[^\s]+/i, '/$1')
      : input;
    if (callback) answerCallback(callback.id);

    if (callbackData.startsWith('chart:')) {
      const [, symbol, timeframe] = callbackData.split(':');
      if (!cooldownExceeded(from.id, 'chart', 4)) await sendChart(chatId, symbol, timeframe);
      return res.status(200).send('OK');
    }
    if (callbackData === 'public:market') {
      if (cooldownExceeded(from.id, 'market', 12)) return res.status(200).send('OK');
      await tgSend(chatId, '⏳ <b>Собираю актуальную ситуацию по рынку и BTC…</b>');
      return publishMarketDaily(req, res, { testChatId: chatId });
    }
    if (callbackData === 'public:fear') {
      if (!cooldownExceeded(from.id, 'fear', 6)) await sendFear(chatId);
      return res.status(200).send('OK');
    }
    if (callbackData === 'public:top') {
      if (!cooldownExceeded(from.id, 'top', 8)) await sendTop(chatId);
      return res.status(200).send('OK');
    }
    if (callbackData.startsWith('public:scenario:')) {
      const symbol = callbackData.split(':')[2] || 'BTC';
      if (!cooldownExceeded(from.id, 'scenario', 8)) {
        sendAction(chatId);
        await tgSend(chatId, await buildScenarioMessage(symbol));
      }
      return res.status(200).send('OK');
    }
    if (callbackData === 'public:calendar') {
      if (!cooldownExceeded(from.id, 'calendar', 8)) {
        sendAction(chatId);
        await tgSend(chatId, await buildCalendarMessage());
      }
      return res.status(200).send('OK');
    }

    if (!command.startsWith('/')) return res.status(200).send('OK');
    const [name, arg1, arg2] = command.split(/\s+/);
    const allowedP2PChat = process.env.P2P_CHAT_ID;
    if (name === '/p2p' && allowedP2PChat && String(chatId) === String(allowedP2PChat)) {
      await handlePrivateP2P(chatId, text);
      return res.status(200).send('OK');
    }

    if (name === '/start' || name === '/help') {
      if (name === '/start') await setBotCommands().catch((error) => console.warn('[bot:commands]', error.message));
      await tgSend(chatId, helpText(), menuKeyboard());
      return res.status(200).send('OK');
    }
    if (name === '/market') {
      if (cooldownExceeded(from.id, 'market', 12)) {
        await tgSend(chatId, '⏳ Обзор уже собирается. Подождите несколько секунд.');
        return res.status(200).send('OK');
      }
      await tgSend(chatId, '⏳ <b>Собираю актуальную ситуацию по рынку и BTC…</b>');
      return publishMarketDaily(req, res, { testChatId: chatId });
    }
    if (name === '/chart') {
      if (!cooldownExceeded(from.id, 'chart', 4)) await sendChart(chatId, arg1 || 'BTC', arg2 || '1h');
      return res.status(200).send('OK');
    }

    const quickChartSymbol = { '/btc': 'BTC', '/eth': 'ETH', '/sol': 'SOL' }[name];
    if (quickChartSymbol) {
      if (!cooldownExceeded(from.id, 'chart', 4)) await sendChart(chatId, quickChartSymbol, arg1 || '1h');
      return res.status(200).send('OK');
    }
    if (name === '/price') {
      if (!cooldownExceeded(from.id, 'price', 4)) await sendPrice(chatId, arg1);
      return res.status(200).send('OK');
    }
    if (name === '/fear') {
      if (!cooldownExceeded(from.id, 'fear', 6)) await sendFear(chatId);
      return res.status(200).send('OK');
    }
    if (name === '/top') {
      if (!cooldownExceeded(from.id, 'top', 8)) await sendTop(chatId);
      return res.status(200).send('OK');
    }
    if (name === '/session') {
      await sendSession(chatId);
      return res.status(200).send('OK');
    }
    if (name === '/scenario') {
      if (!cooldownExceeded(from.id, 'scenario', 8)) {
        sendAction(chatId);
        await tgSend(chatId, await buildScenarioMessage(arg1 || 'BTC'));
      }
      return res.status(200).send('OK');
    }
    if (name === '/calendar') {
      if (!cooldownExceeded(from.id, 'calendar', 8)) {
        sendAction(chatId);
        await tgSend(chatId, await buildCalendarMessage());
      }
      return res.status(200).send('OK');
    }

    await tgSend(chatId, `⚠️ Такой публичной команды нет.\n\nНажмите /help, чтобы открыть меню <b>EYE Eternity</b>.`);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[bot]', error);
    const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
    if (chatId) {
      await tgSend(chatId,
        `⚠️ <b>Не удалось выполнить запрос</b>\n\n${escapeHtml(String(error.message || 'Временная ошибка').slice(0, 240))}\n\nПопробуйте ещё раз через минуту.`,
      );
    }
    return res.status(200).send('OK');
  }
}
