import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.CRON_SECRET = 'test-secret';
process.env.ETERNITY_CHANNEL_ID = '@eternity_test';
process.env.ETERNITY_CHAT_ID = '-100123456789';
process.env.APP_URL = 'https://example.test';

const { default: handler } = await import('../api/daily.js?api-test=1');
const { publishMarketDaily } = await import('../lib/market-daily-runtime.js');

function makeDailyRows(count = 70) {
  const start = Date.UTC(2026, 4, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 60_000 + index * 500;
    return [
      String(start + index * 86_400_000),
      String(close - 200),
      String(close + 800),
      String(close - 900),
      String(close),
      String(1_000 + index * 10),
      '0',
    ];
  }).reverse();
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function marketFetchMock(calls) {
  return async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('/v5/market/tickers')) {
      return jsonResponse({ retCode: 0, result: { list: [{
        lastPrice: '97500',
        price24hPcnt: '0.0125',
        highPrice24h: '98100',
        lowPrice24h: '95800',
        turnover24h: '4200000000',
        openInterestValue: '31000000000',
        fundingRate: '0.0001',
      }] } });
    }
    if (url.includes('/v5/market/kline')) {
      return jsonResponse({ retCode: 0, result: { list: makeDailyRows() } });
    }
    if (url.includes('/v5/market/open-interest')) {
      return jsonResponse({ retCode: 0, result: { list: [
        { timestamp: '1786665600000', openInterest: '320000' },
        { timestamp: '1786752000000', openInterest: '326400' },
      ] } });
    }
    if (url.includes('alternative.me')) {
      return jsonResponse({ data: [{ value: '58' }] });
    }
    if (url.includes('/api/finnhub')) {
      return jsonResponse({ events: [] });
    }
    if (url.includes('api.telegram.org')) {
      return jsonResponse({ ok: true, result: { message_id: calls.length } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function fallbackMarketFetchMock(calls) {
  const bybitRows = makeDailyRows();
  const coinbaseRows = bybitRows.map((row) => [
    Math.floor(Number(row[0]) / 1000),
    row[3],
    row[2],
    row[1],
    row[4],
    row[5],
  ]);
  return async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('api.bybit.com')) return jsonResponse({ error: 'forbidden' }, 403);
    if (url.endsWith('/products/BTC-USD/ticker')) {
      return jsonResponse({ price: '97500', volume: '12000' });
    }
    if (url.endsWith('/products/BTC-USD/stats')) {
      return jsonResponse({ open: '96200', high: '98100', low: '95800', last: '97500', volume: '12000' });
    }
    if (url.includes('/products/BTC-USD/candles')) return jsonResponse(coinbaseRows);
    if (url.includes('deribit.com')) {
      return jsonResponse({ result: { open_interest: 31_000_000_000, funding_8h: 0.0001 } });
    }
    if (url.includes('alternative.me')) return jsonResponse({ data: [{ value: '58' }] });
    if (url.includes('/api/finnhub')) return jsonResponse({ events: [] });
    if (url.includes('api.telegram.org')) {
      return jsonResponse({ ok: true, result: { message_id: calls.length } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('rejects requests without the cron authorization header', async () => {
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {}, query: { action: 'market' } }, response);
  assert.equal(response.statusCode, 401);
});

test('dry run returns both formatted messages without Telegram delivery', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = marketFetchMock(calls);
  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer test-secret' },
      query: { action: 'market', dry_run: '1' },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.preview, true);
    assert.match(response.body.channelMessage, /ЕЖЕДНЕВНЫЙ ОБЗОР/);
    assert.match(response.body.chatMessage, /сценарий на день/);
    assert.equal(calls.filter((call) => call.url.includes('api.telegram.org')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('live run delivers separate messages to channel and chat', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = marketFetchMock(calls);
  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer test-secret' },
      query: { action: 'market' },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.delivered, 2);
    const telegramCalls = calls.filter((call) => call.url.includes('api.telegram.org'));
    assert.equal(telegramCalls.length, 2);
    const bodies = telegramCalls.map((call) => JSON.parse(call.options.body));
    assert.equal(bodies[0].chat_id, '@eternity_test');
    assert.equal(bodies[1].chat_id, '-100123456789');
    assert.match(bodies[0].text, /📊/);
    assert.match(bodies[1].text, /🗣/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('bot test mode delivers the full overview only to the requesting chat', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = marketFetchMock(calls);
  try {
    const response = responseRecorder();
    await publishMarketDaily({ method: 'POST', headers: {}, query: {} }, response, {
      testChatId: 6746369295,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.delivered, 1);
    const telegramCalls = calls.filter((call) => call.url.includes('api.telegram.org'));
    assert.equal(telegramCalls.length, 1);
    const body = JSON.parse(telegramCalls[0].options.body);
    assert.equal(body.chat_id, 6746369295);
    assert.match(body.text, /📊 <b>ЕЖЕДНЕВНЫЙ ОБЗОР/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('falls back to Coinbase and Deribit when Bybit blocks the Vercel region', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = fallbackMarketFetchMock(calls);
  try {
    const response = responseRecorder();
    await publishMarketDaily({ method: 'POST', headers: {}, query: {} }, response, {
      testChatId: 6746369295,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.delivered, 1);
    assert.ok(calls.some((call) => call.url.includes('api.bybit.com')));
    assert.ok(calls.some((call) => call.url.includes('api.exchange.coinbase.com')));
    assert.ok(calls.some((call) => call.url.includes('deribit.com')));
    const telegramCall = calls.find((call) => call.url.includes('api.telegram.org'));
    assert.match(JSON.parse(telegramCall.options.body).text, /ЕЖЕДНЕВНЫЙ ОБЗОР/);
  } finally {
    global.fetch = originalFetch;
  }
});
