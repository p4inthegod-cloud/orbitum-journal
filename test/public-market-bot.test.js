import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateCandles,
  buildChartCaption,
  buildChartConfig,
  getTradingSession,
  normalizeSymbol,
  normalizeTimeframe,
  summarizeCandles,
} from '../lib/public-market-bot.js';

const candles = Array.from({ length: 24 }, (_, index) => ({
  x: Date.UTC(2026, 7, 15, index),
  o: 100 + index,
  h: 102 + index,
  l: 98 + index,
  c: 101 + index,
  v: 10 + index,
}));

test('нормализует тикеры и публичные таймфреймы', () => {
  assert.equal(normalizeSymbol('btc/usdt'), 'BTC');
  assert.equal(normalizeSymbol('xbt-usd'), 'BTC');
  assert.equal(normalizeSymbol('<bad>'), null);
  assert.equal(normalizeTimeframe('15м'), '15m');
  assert.equal(normalizeTimeframe('4h'), '4h');
  assert.equal(normalizeTimeframe('2h'), null);
});

test('собирает четырёхчасовые свечи из часовых', () => {
  const aggregated = aggregateCandles(candles, 4);
  assert.equal(aggregated.length, 6);
  assert.deepEqual(aggregated[0], {
    x: candles[0].x,
    o: 100,
    h: 105,
    l: 98,
    c: 104,
    v: 46,
  });
});

test('создаёт тёмный свечной график с брендом EYE Eternity', () => {
  const config = buildChartConfig('BTC', '1h', candles);
  assert.equal(config.type, 'candlestick');
  assert.match(config.options.plugins.title.text, /EYE Eternity/);
  assert.equal(config.data.datasets[0].data.length, 24);
});

test('формирует русскую подпись без ссылок на сайт', () => {
  const caption = buildChartCaption('BTC', '1h', candles, 'Coinbase');
  assert.match(caption, /EYE Eternity/);
  assert.match(caption, /Таймфрейм/);
  assert.doesNotMatch(caption, /orbitum|https?:\/\//i);
  const summary = summarizeCandles(candles);
  assert.equal(summary.price, 124);
  assert.ok(summary.changePct > 0);
});

test('определяет торговую сессию по UTC', () => {
  assert.equal(getTradingSession(new Date('2026-08-15T02:00:00Z')).name, 'Азиатская');
  assert.equal(getTradingSession(new Date('2026-08-15T13:00:00Z')).name, 'Пересечение Лондона и Нью-Йорка');
});
