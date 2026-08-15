import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCoin, getSessionWarning, shouldWarnEvent } from '../lib/market-notifications.js';

function candles(count, start, step, { spread = 10, volume = 100 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const open = start + index * step;
    const close = open + step * 0.7;
    return { x: index, o: open, h: Math.max(open, close) + spread, l: Math.min(open, close) - spread, c: close, v: volume };
  });
}

test('analyzeCoin combines timeframes into an argued upward bias', () => {
  const analysis = analyzeCoin(
    'BTC',
    candles(80, 56_000, 25, { spread: 40, volume: 150 }),
    candles(80, 50_000, 100),
    candles(80, 35_000, 250, { spread: 500 }),
  );
  assert.equal(analysis.trend.key, 'bullish');
  assert.ok(analysis.bullishScore >= 6);
  assert.equal(analysis.structure.key, 'bullish');
  assert.ok(analysis.longTarget > analysis.upTrigger);
  assert.ok(analysis.previousHigh > analysis.previousLow);
});

test('analyzeCoin identifies bearish structure and relative weakness against BTC', () => {
  const analysis = analyzeCoin(
    'ETH',
    candles(80, 4_200, -4, { spread: 4, volume: 120 }),
    candles(80, 4_000, -10, { spread: 4 }),
    candles(80, 6_000, -50, { spread: 50 }),
    candles(80, 50_000, 100),
  );
  assert.equal(analysis.trend.key, 'bearish');
  assert.ok(analysis.bearishScore >= 6);
  assert.equal(analysis.structure.key, 'bearish');
  assert.ok(analysis.relativeStrength < 0);
  assert.ok(analysis.shortTarget < analysis.downTrigger);
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
