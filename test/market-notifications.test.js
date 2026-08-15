import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScenario, getSessionWarning, shouldWarnEvent } from '../lib/market-notifications.js';

function candles(count, start, step, { spread = 10, volume = 100 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const open = start + index * step;
    const close = open + step * 0.7;
    return { x: index, o: open, h: Math.max(open, close) + spread, l: Math.min(open, close) - spread, c: close, v: volume };
  });
}

test('analyzeScenario identifies an upward structure', () => {
  const scenario = analyzeScenario('BTC', candles(80, 50_000, 100), candles(30, 45_000, 250, { spread: 500 }));
  assert.equal(scenario.trend.key, 'bullish');
  assert.ok(scenario.longTarget > scenario.previousHigh);
  assert.ok(scenario.previousHigh > scenario.previousLow);
});

test('analyzeScenario identifies a downward structure', () => {
  const scenario = analyzeScenario('ETH', candles(80, 4_000, -10, { spread: 4 }), candles(30, 5_000, -50, { spread: 50 }));
  assert.equal(scenario.trend.key, 'bearish');
  assert.ok(scenario.shortTarget < scenario.previousLow);
});

test('session warnings respect regional daylight-saving time', () => {
  assert.equal(getSessionWarning(new Date('2026-08-16T23:55:00Z'))?.id, 'asia');
  assert.equal(getSessionWarning(new Date('2026-08-16T06:55:00Z'))?.id, 'london');
  assert.equal(getSessionWarning(new Date('2026-08-16T11:55:00Z'))?.id, 'new-york');
  assert.equal(getSessionWarning(new Date('2026-08-16T12:15:00Z')), null);
});

test('event warning is limited to important US events about 30 minutes away', () => {
  const now = new Date('2026-08-16T10:00:00Z');
  const base = { timestamp: now.getTime() + 30 * 60_000, impact: 'high', country: 'USD' };
  assert.equal(shouldWarnEvent(base, now), true);
  assert.equal(shouldWarnEvent({ ...base, impact: 'low' }, now), false);
  assert.equal(shouldWarnEvent({ ...base, country: 'EUR' }, now), false);
  assert.equal(shouldWarnEvent({ ...base, timestamp: now.getTime() + 60 * 60_000 }, now), false);
});
