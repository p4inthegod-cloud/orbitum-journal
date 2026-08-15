import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeMarket,
  atr,
  attachEconomicCalendar,
  buildChannelMessage,
  buildChatMessage,
  ema,
  parseKlines,
} from '../lib/market-brief.js';

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

test('parseKlines normalizes Bybit reverse chronological response', () => {
  const parsed = parseKlines(makeDailyRows(3));
  assert.equal(parsed.length, 3);
  assert.ok(parsed[0].start < parsed[1].start);
});

test('EMA and ATR return finite values for a valid window', () => {
  const candles = parseKlines(makeDailyRows(60));
  assert.ok(Number.isFinite(ema(candles.map((candle) => candle.close), 50)));
  assert.ok(Number.isFinite(atr(candles, 14)));
});

test('analysis creates conditional levels and readable Telegram messages', () => {
  const analysis = analyzeMarket({
    symbol: 'BTCUSDT',
    now: new Date('2026-08-15T07:00:00.000Z'),
    ticker: {
      lastPrice: '97500',
      price24hPcnt: '0.0125',
      highPrice24h: '98100',
      lowPrice24h: '95800',
      turnover24h: '4200000000',
      openInterestValue: '31000000000',
      fundingRate: '0.0001',
    },
    dailyRows: makeDailyRows(70),
    openInterestRows: [
      { timestamp: '1786665600000', openInterest: '320000' },
      { timestamp: '1786752000000', openInterest: '326400' },
    ],
    fearGreed: '58',
  });

  assert.equal(analysis.symbol, 'BTC');
  assert.equal(analysis.trend.key, 'bullish');
  assert.ok(analysis.previousHigh > analysis.previousLow);
  assert.ok(analysis.longTarget > analysis.previousHigh);
  assert.ok(analysis.shortTarget < analysis.previousLow);

  const withCalendar = attachEconomicCalendar(analysis, [{
    title: 'Consumer Price Index',
    country: 'USD',
    impact: 'high',
    timestamp: Date.parse('2026-08-15T12:30:00.000Z'),
  }]);
  const channel = buildChannelMessage(withCalendar, 'https://orbitum.trade');
  const chat = buildChatMessage(withCalendar, 'https://orbitum.trade');
  assert.match(channel, /🌅 <b>УТРЕННИЙ ОБЗОР — BTC<\/b>/);
  assert.match(channel, /🟢 <b>Сценарий вверх<\/b>/);
  assert.match(channel, /Это сценарий работы с рынком/);
  assert.match(channel, /Индекс потребительских цен/);
  assert.match(chat, /Какой сценарий рассматриваете/);
  assert.ok(channel.length < 4096);
});

test('missing sentiment data remains unavailable instead of becoming zero', () => {
  const analysis = analyzeMarket({
    symbol: 'BTCUSDT',
    now: new Date('2026-08-15T07:00:00.000Z'),
    ticker: { lastPrice: '97500', price24hPcnt: '0', fundingRate: '' },
    dailyRows: makeDailyRows(70),
    fearGreed: null,
  });
  assert.equal(analysis.fearGreed, null);
  assert.equal(analysis.fundingPct, 0);
});
