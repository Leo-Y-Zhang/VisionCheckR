// staircase.test.mjs
// Step 4: a deterministic transformed-staircase threshold estimator. It CONSUMES
// a completed run of {level, correct} trials and estimates the threshold as the
// mean of the last N reversal levels. Screening only, never clinical.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { staircaseThreshold } from '../scoring.mjs';

// A response is "correct" when the next level goes down (harder). The last trial
// is treated as correct. The estimate uses the LEVELS, not this flag, so this is
// only to build well-formed trial objects.
function trialsFromLevels(levels) {
  return levels.map((level, i) => ({
    level,
    correct: i === levels.length - 1 ? true : levels[i + 1] <= level,
  }));
}

test('staircaseThreshold: estimates the mean of the reversal levels', () => {
  const r = staircaseThreshold(trialsFromLevels([0.8, 0.6, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5]));
  assert.equal(r.inconclusive, false);
  assert.equal(r.usableReversals, 5); // reversals: 0.4,0.5,0.4,0.5,0.4
  assert.ok(Math.abs(r.threshold - 0.44) < 1e-9, `threshold ${r.threshold}`);
  const note = r.note.toLowerCase();
  assert.ok(note.includes('screening'));
  assert.ok(note.includes('professional'));
});

test('staircaseThreshold: only the last N reversals count (early anomalies drop out)', () => {
  // Wild early swing (0.9, 1.0) then settles around 0.45; last 6 reversals win.
  const levels = [1.0, 0.9, 1.0, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4];
  const r = staircaseThreshold(trialsFromLevels(levels));
  assert.equal(r.usableReversals, 10);
  assert.equal(r.nReversalsUsed, 6);
  assert.ok(Math.abs(r.threshold - 0.45) < 1e-9, `threshold ${r.threshold}`);
});

test('staircaseThreshold: too few reversals is inconclusive, never a guess', () => {
  assert.equal(staircaseThreshold(trialsFromLevels([0.8, 0.6, 0.4])).inconclusive, true); // 0 reversals
  const one = staircaseThreshold(trialsFromLevels([0.8, 0.6, 0.7])); // 1 reversal
  assert.equal(one.inconclusive, true);
  assert.equal(one.threshold, null);
});

test('staircaseThreshold: works generically on acuity MAR levels', () => {
  const r = staircaseThreshold(trialsFromLevels([2.0, 1.5, 1.0, 1.2, 1.0, 1.2, 1.0, 1.2]));
  assert.equal(r.inconclusive, false);
  assert.ok(Number.isFinite(r.threshold));
  assert.ok(r.threshold > 1.0 && r.threshold < 1.3);
});

test('staircaseThreshold: fails loud on malformed input', () => {
  assert.throws(() => staircaseThreshold('x'), TypeError);
  assert.throws(() => staircaseThreshold([]), RangeError);
  assert.throws(() => staircaseThreshold([{ level: 0.5 }]), TypeError); // correct missing
  assert.throws(() => staircaseThreshold([{ level: 'x', correct: true }]), TypeError);
  assert.throws(() => staircaseThreshold([{ level: 0.5, correct: 'yes' }]), TypeError);
});
