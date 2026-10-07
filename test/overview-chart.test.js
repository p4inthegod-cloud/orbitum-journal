import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../js/journal-concept.js', import.meta.url), 'utf8');
const rows = (count=240, offset=0) => Array.from({length:count}, (_, i) => ({time:(i + offset) * 900000}));
function load() {
  const context = vm.createContext({document:{addEventListener() {}}, Math, Number});
  vm.runInContext(source, context);
  vm.runInContext('worldDrawCandles = () => {};', context);
  return context;
}

test('zoom anchors the candle under the pointer and stays within history bounds', () => {
  const c = load(); c.worldSyncChartCandles(rows(), 'BTC:15m');
  const before = c.worldChartRange(), anchor = .25;
  c.worldZoomChart(-100, anchor);
  const after = c.worldChartRange();
  assert.ok(after.count < before.count);
  assert.ok(Math.abs((before.start + anchor * before.count) - (after.start + anchor * after.count)) <= .5);
  for (let i=0; i<40; i++) c.worldZoomChart(-240, .5);
  assert.equal(c.worldChartRange().count, 12);
  for (let i=0; i<40; i++) c.worldZoomChart(240, .5);
  assert.equal(c.worldChartRange().count, 240);
  assert.equal(c.worldChartRange().start, 0);
});

test('refresh preserves the inspected timestamp when the history window rolls forward', () => {
  const c = load(); c.worldSyncChartCandles(rows(), 'BTC:15m');
  vm.runInContext('worldChartViewport.start = 40; worldChartViewport.count = 24;', c);
  const time = c.worldChartRange().candles[0].time;
  c.worldSyncChartCandles([], 'BTC:15m');
  c.worldSyncChartCandles(rows(240, 1), 'BTC:15m');
  assert.equal(c.worldChartRange().candles[0].time, time);
  assert.equal(c.worldChartRange().count, 24);
});

test('a view at the latest candle follows new data and reset restores the last 64 candles', () => {
  const c = load(); c.worldSyncChartCandles(rows(), 'BTC:15m');
  c.worldZoomChart(-100, 1);
  const count = c.worldChartRange().count;
  c.worldSyncChartCandles(rows(241), 'BTC:15m');
  assert.equal(c.worldChartRange().start + count, 241);
  c.worldResetChart();
  assert.equal(c.worldChartRange().count, 64);
  assert.equal(c.worldChartRange().start, 177);
});

test('switching symbol or period resets the viewport, including a short history', () => {
  const c = load(); c.worldSyncChartCandles(rows(), 'BTC:15m');
  c.worldZoomChart(-100, .5);
  c.worldSyncChartCandles(rows(100), 'ETH:1h');
  assert.equal(c.worldChartRange().count, 64);
  assert.equal(c.worldChartRange().start, 36);
  c.worldSyncChartCandles(rows(5), 'ETH:4h');
  c.worldZoomChart(-240, 1);
  assert.equal(c.worldChartRange().count, 5);
  assert.equal(c.worldChartRange().start, 0);
});
