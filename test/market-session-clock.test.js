import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../journal.html', import.meta.url), 'utf8');
const clock = html.slice(html.indexOf('const ENV_PHASES='), html.indexOf('function environmentCountdown('));
assert.ok(clock.startsWith('const ENV_PHASES='), 'session clock source exists');
const context = vm.createContext({ Date, Intl, Map, Set, Object, Number, Math });
vm.runInContext(`${clock}\nthis.environmentPhase = environmentPhase;`, context);

test('показывает открытие Нью-Йорка, а не конец пересечения', () => {
  const before = context.environmentPhase(new Date('2026-09-30T13:19:00Z'));
  assert.equal(before.phase.code, 'LONDON');
  assert.equal(before.eventLabel, 'Нью-Йорк откроется');
  assert.equal(before.transition.toISOString(), '2026-09-30T13:30:00.000Z');
  assert.equal(before.minutes, 11);
  assert.equal(before.windowLabel, '07:00–13:30 UTC');

  const after = context.environmentPhase(new Date('2026-09-30T13:30:00Z'));
  assert.equal(after.phase.code, 'OVERLAP');
  assert.equal(after.eventLabel, 'Лондон закроется');
  assert.equal(after.transition.toISOString(), '2026-09-30T15:30:00.000Z');
});

test('учитывает зимнее время обеих площадок', () => {
  const winter = context.environmentPhase(new Date('2026-12-01T14:19:00Z'));
  assert.equal(winter.phase.code, 'LONDON');
  assert.equal(winter.transition.toISOString(), '2026-12-01T14:30:00.000Z');
  assert.equal(winter.windowLabel, '08:00–14:30 UTC');
  const overlap = context.environmentPhase(new Date('2026-12-01T14:30:00Z'));
  assert.equal(overlap.phase.code, 'OVERLAP');
  assert.equal(overlap.transition.toISOString(), '2026-12-01T16:30:00.000Z');
});

test('учитывает неделю с разными датами перехода на зимнее время', () => {
  const gap = context.environmentPhase(new Date('2026-10-28T13:19:00Z'));
  assert.equal(gap.phase.code, 'LONDON');
  assert.equal(gap.transition.toISOString(), '2026-10-28T13:30:00.000Z');
  const overlap = context.environmentPhase(new Date('2026-10-28T13:30:00Z'));
  assert.equal(overlap.transition.toISOString(), '2026-10-28T16:30:00.000Z');
});

test('строит непрерывную карту суток с правильными границами', () => {
  const result = context.environmentPhase(new Date('2026-09-30T13:19:00Z'));
  const schedule = Array.from(result.schedule, x => ({ code: x.phase.code, start: x.start, end: x.end }));
  assert.equal(schedule[0].start, Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(schedule.at(-1).end, Date.parse('2026-10-01T00:00:00Z'));
  assert.ok(schedule.every((segment, index) => segment.end === schedule[index + 1]?.start || index === schedule.length - 1));
  assert.deepEqual(schedule.map(x => x.code), ['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK', 'OFF_HOURS']);
});
