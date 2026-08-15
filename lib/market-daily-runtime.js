import {
  analyzeMarket,
  attachEconomicCalendar,
  buildChannelMessage,
  buildChatMessage,
} from './market-brief.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.ETERNITY_CHANNEL_ID;
const CHAT_ID = process.env.ETERNITY_CHAT_ID;
const CHAT_THREAD_ID = process.env.ETERNITY_CHAT_THREAD_ID;
const APP_URL = process.env.APP_URL || 'https://orbitum.trade';
const SYMBOL = (process.env.MARKET_BRIEF_SYMBOL || 'BTCUSDT').toUpperCase();
const BYBIT_API = 'https://api.bybit.com';
const COINBASE_API = 'https://api.exchange.coinbase.com';
const DERIBIT_API = 'https://www.deribit.com/api/v2';

async function fetchJson(url, timeoutMs = 8_000) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'EternityTrade-MarketBrief/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.json();
}

async function fetchBybit(path, params) {
  const url = new URL(path, BYBIT_API);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await fetchJson(url.toString());
  if (payload?.retCode !== 0) throw new Error(`Bybit: ${payload?.retMsg || 'unknown error'}`);
  return payload.result;
}

async function collectBybitMarketData() {
  const [tickerResult, dailyResult, openInterestResult] = await Promise.allSettled([
    fetchBybit('/v5/market/tickers', { category: 'linear', symbol: SYMBOL }),
    fetchBybit('/v5/market/kline', { category: 'linear', symbol: SYMBOL, interval: 'D', limit: '70' }),
    fetchBybit('/v5/market/open-interest', { category: 'linear', symbol: SYMBOL, intervalTime: '1d', limit: '5' }),
  ]);

  if (tickerResult.status === 'rejected') throw tickerResult.reason;
  if (dailyResult.status === 'rejected') throw dailyResult.reason;

  const ticker = tickerResult.value?.list?.[0];
  const dailyRows = dailyResult.value?.list || [];
  const openInterestRows = openInterestResult.status === 'fulfilled'
    ? openInterestResult.value?.list || []
    : [];
  return { ticker, dailyRows, openInterestRows, source: 'Bybit' };
}

function symbolBase() {
  return SYMBOL.replace(/(?:USDT|USDC|USD)$/, '');
}

async function collectCoinbaseMarketData() {
  const base = symbolBase();
  const product = `${base}-USD`;
  const deribitInstrument = ['BTC', 'ETH'].includes(base) ? `${base}-PERPETUAL` : null;
  const requests = [
    fetchJson(`${COINBASE_API}/products/${product}/ticker`),
    fetchJson(`${COINBASE_API}/products/${product}/stats`),
    fetchJson(`${COINBASE_API}/products/${product}/candles?granularity=86400`),
    deribitInstrument
      ? fetchJson(`${DERIBIT_API}/public/ticker?instrument_name=${deribitInstrument}`)
      : Promise.resolve(null),
  ];
  const [tickerResult, statsResult, candlesResult, derivativesResult] = await Promise.allSettled(requests);
  if (tickerResult.status === 'rejected') throw tickerResult.reason;
  if (statsResult.status === 'rejected') throw statsResult.reason;
  if (candlesResult.status === 'rejected') throw candlesResult.reason;

  const spotTicker = tickerResult.value || {};
  const stats = statsResult.value || {};
  const derivatives = derivativesResult.status === 'fulfilled'
    ? derivativesResult.value?.result || null
    : null;
  const price = Number(spotTicker.price || stats.last);
  const open24 = Number(stats.open);
  const volume = Number(stats.volume || spotTicker.volume || 0);
  const dailyRows = (Array.isArray(candlesResult.value) ? candlesResult.value : []).map((row) => [
    String(Number(row?.[0]) * 1000),
    String(row?.[3] ?? ''),
    String(row?.[2] ?? ''),
    String(row?.[1] ?? ''),
    String(row?.[4] ?? ''),
    String(row?.[5] ?? 0),
  ]);

  return {
    ticker: {
      lastPrice: String(price),
      price24hPcnt: String(open24 ? (price - open24) / open24 : 0),
      highPrice24h: String(stats.high || ''),
      lowPrice24h: String(stats.low || ''),
      turnover24h: String(Number.isFinite(price * volume) ? price * volume : 0),
      openInterestValue: derivatives?.open_interest == null ? '' : String(derivatives.open_interest),
      fundingRate: derivatives?.funding_8h == null ? '' : String(derivatives.funding_8h),
    },
    dailyRows,
    openInterestRows: [],
    source: derivatives ? 'Coinbase + Deribit' : 'Coinbase',
  };
}

async function collectMarketData() {
  const fearGreedPromise = fetchJson('https://api.alternative.me/fng/?limit=1')
    .then((data) => data?.data?.[0]?.value ?? null)
    .catch(() => null);
  let marketData;
  try {
    marketData = await collectBybitMarketData();
  } catch (error) {
    console.warn('[market-daily:source] Bybit unavailable, using fallback:', error.message);
    marketData = await collectCoinbaseMarketData();
  }
  return { ...marketData, fearGreed: await fearGreedPromise };
}

function moscowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function collectEconomicCalendar(now = new Date()) {
  try {
    const date = moscowDate(now);
    const baseUrl = (process.env.MARKET_CONTEXT_URL || 'https://www.orbitum.trade').replace(/\/$/, '');
    const data = await fetchJson(
      `${baseUrl}/api/finnhub?type=calendar&from=${date}&to=${date}`,
      7_000,
    );
    return { available: true, events: Array.isArray(data?.events) ? data.events : [] };
  } catch (error) {
    console.warn('[market-daily:calendar]', error.message);
    return { available: false, events: [] };
  }
}

async function sendTelegramMessage(chatId, text, messageThreadId = null) {
  const send = async (targetChatId) => {
    const body = {
      chat_id: targetChatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (messageThreadId) body.message_thread_id = Number(messageThreadId);
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  let { response, payload } = await send(chatId);
  const migratedChatId = payload?.parameters?.migrate_to_chat_id;
  if ((!response.ok || !payload.ok) && migratedChatId) {
    console.log(`[market-daily] retrying migrated supergroup ${chatId} -> ${migratedChatId}`);
    ({ response, payload } = await send(migratedChatId));
    chatId = migratedChatId;
  }
  if (!response.ok || !payload.ok) {
    throw new Error(payload?.description || `Telegram HTTP ${response.status}`);
  }
  return { chatId, messageId: payload.result?.message_id };
}

export async function publishMarketDaily(req, res, { testChatId = null } = {}) {
  try {
    const now = new Date();
    const [marketData, calendar] = await Promise.all([
      collectMarketData(),
      collectEconomicCalendar(now),
    ]);
    const technicalAnalysis = analyzeMarket({ symbol: SYMBOL, ...marketData, now });
    const analysis = attachEconomicCalendar(
      technicalAnalysis,
      calendar.events,
      calendar.available,
    );
    const channelMessage = buildChannelMessage(analysis, APP_URL);
    const chatMessage = buildChatMessage(analysis, APP_URL);

    if (req.query?.dry_run === '1' || req.query?.preview === '1') {
      return res.status(200).json({
        ok: true,
        preview: true,
        channelMessage,
        chatMessage,
        levels: {
          support: analysis.previousLow,
          resistance: analysis.previousHigh,
          targetUp: analysis.longTarget,
          targetDown: analysis.shortTarget,
        },
      });
    }

    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
    }
    if (!testChatId && !CHANNEL_ID && !CHAT_ID) {
      return res.status(500).json({ error: 'ETERNITY_CHANNEL_ID or ETERNITY_CHAT_ID is required' });
    }

    const deliveries = [];
    if (testChatId) {
      deliveries.push({ target: 'test', promise: sendTelegramMessage(testChatId, channelMessage) });
    } else if (CHANNEL_ID) {
      deliveries.push({ target: 'channel', promise: sendTelegramMessage(CHANNEL_ID, channelMessage) });
    }
    if (!testChatId && CHAT_ID && CHAT_ID !== CHANNEL_ID) {
      deliveries.push({
        target: 'chat',
        promise: sendTelegramMessage(CHAT_ID, chatMessage, CHAT_THREAD_ID),
      });
    }

    const settled = await Promise.allSettled(deliveries.map((item) => item.promise));
    const results = settled.map((result, index) => ({
      target: deliveries[index].target,
      ok: result.status === 'fulfilled',
      ...(result.status === 'fulfilled'
        ? result.value
        : { error: result.reason?.message || 'Delivery failed' }),
    }));
    const delivered = results.filter((result) => result.ok).length;

    console.log(`[market-daily] symbol=${SYMBOL} delivered=${delivered}/${results.length}`);
    return res.status(delivered === results.length ? 200 : 207).json({
      ok: delivered === results.length,
      symbol: SYMBOL,
      delivered,
      results,
    });
  } catch (error) {
    console.error('[market-daily]', error);
    if (testChatId && BOT_TOKEN) {
      await sendTelegramMessage(
        testChatId,
        `⚠️ <b>Не удалось собрать обзор</b>\n\nИсточник рыночных данных временно недоступен. Попробуйте команду ещё раз через несколько минут.`,
      ).catch(() => {});
      return res.status(200).json({ ok: false, error: error.message || 'Market brief failed' });
    }
    return res.status(502).json({ error: error.message || 'Market brief failed' });
  }
}
