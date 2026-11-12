'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Tracker, threshold, metric, level } = require('../media/balance-alerts');
const definitions = require('../backend/providers.json');
const money = (total, currency = 'USD') => ({ total, currency });

test('alerts follow only downward color transitions for every provider', () => {
  const tracker = new Tracker();
  for (const { id } of definitions) {
    // Startup low is silent; recovery rearms both the low and exhausted warnings.
    const readings = [4, 4, 0, 0, 3, 3, 0, 9, 5, 4, 9, 0, 4, 0];
    const warnings = readings.map(value => tracker.observe(id, money(value), 5)?.level || null);
    assert.deepEqual(warnings, [null,null,'zero',null,null,null,'zero',null,null,'low',null,'zero',null,'zero'], id);
  }
});

test('disabled alerts stay neutral at zero; startup and preference changes are silent', () => {
  const tracker = new Tracker();
  assert.equal(threshold(-2), 0);
  assert.equal(threshold('invalid'), 0);
  for (const initial of [10, 2, 0, -3]) {
    tracker.reset('p');
    assert.equal(tracker.observe('p', money(initial), 5), null);
    assert.equal(level(money(initial), 0), 'ok');
  }
  for (const value of [10, 2, 0, -5, 10, 0]) assert.equal(tracker.observe('p', money(value), 0), null);
  assert.equal(tracker.observe('p', money(0), 5), null);
  assert.equal(tracker.observe('p', money(9), 2), null);
  assert.equal(tracker.observe('p', money(1), 2).level, 'low');
  assert.equal(new Tracker().observe('p', money(0), 2), null, 'restart');
});

test('quota, currency changes and unavailable metrics never fabricate alerts', () => {
  const tracker = new Tracker();
  const quota = value => ({ windows: [{remaining:80}, {remaining:value}] });
  assert.deepEqual(metric(quota(3)), {value:3,unit:'%'});
  assert.equal(tracker.observe('p', quota(80), 5), null);
  assert.equal(tracker.observe('p', quota(3), 5).level, 'low');
  assert.equal(tracker.observe('p', quota(0), 5).level, 'zero');
  assert.equal(tracker.observe('p', money(2, 'CNY'), 5), null);
  assert.equal(tracker.observe('p', money(0, 'CNY'), 5).level, 'zero');
  for (const balance of [null, {}, {total:0}, money(NaN), money(Infinity), {windows:[{remaining:null}]}]) {
    assert.equal(metric(balance), null);
    assert.equal(tracker.observe('p', balance, 5), null);
  }
  tracker.reset('p');
  assert.equal(tracker.observe('p', money(0, 'CNY'), 5), null);
});
