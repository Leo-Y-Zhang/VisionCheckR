// nearAcuity.test.mjs
// Step 3: near (reading) acuity at ~40 cm. Screening only, not a glasses
// prescription. Reuses the distance-acuity MAR math at a near design distance.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCLAIMER,
  NEAR_DEFAULT_DESIGN_DISTANCE_M,
  acuityScore,
  nearAcuityScore,
  summarize,
} from '../scoring.mjs';

test('nearAcuityScore: reading the 20/20-equivalent line at 40cm is typical', () => {
  const r = nearAcuityScore({ lineIndex: 7, actualDistanceM: NEAR_DEFAULT_DESIGN_DISTANCE_M });
  assert.equal(r.readable, true);
  assert.equal(r.band, 'typical');
  assert.equal(r.logMAR, 0);
  assert.match(r.nApprox, /^N\d+$/);
  assert.ok(r.note.toLowerCase().includes('prescription'), 'note frames it as not a prescription');
});

test('nearAcuityScore: only the largest line is notably reduced', () => {
  assert.equal(nearAcuityScore({ lineIndex: 0, actualDistanceM: 0.4 }).band, 'notably-reduced');
});

test('nearAcuityScore: no line read is inconclusive, not an error', () => {
  const r = nearAcuityScore({ lineIndex: -1, actualDistanceM: 0.4 });
  assert.equal(r.readable, false);
  assert.equal(r.band, 'inconclusive');
});

test('nearAcuityScore: viewing distance rescales the effective MAR', () => {
  assert.equal(nearAcuityScore({ lineIndex: 7, actualDistanceM: 0.4 }).effectiveMAR, 1);
  assert.equal(nearAcuityScore({ lineIndex: 7, actualDistanceM: 0.8 }).effectiveMAR, 0.5);
});

test('nearAcuityScore: fails loud on malformed input', () => {
  assert.throws(() => nearAcuityScore({ lineIndex: 1.5, actualDistanceM: 0.4 }), RangeError);
  assert.throws(() => nearAcuityScore({ lineIndex: 3, actualDistanceM: -1 }), RangeError);
  assert.throws(() => nearAcuityScore({ lineIndex: 'x', actualDistanceM: 0.4 }), TypeError);
});

test('refactor guard: distance acuityScore output is unchanged', () => {
  const a = acuityScore({ lineIndex: 7, actualDistanceM: 3 });
  assert.equal(a.snellen, '20/20');
  assert.equal(a.logMAR, 0);
  assert.equal(a.band, 'typical');
});

test('summarize: near vision folds in as a module and flags when reduced', () => {
  const s = summarize({ nearAcuity: nearAcuityScore({ lineIndex: 0, actualDistanceM: 0.4 }) });
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.ok(s.flags.includes('nearAcuity'));
  assert.ok(s.lines.some((l) => /near vision/i.test(l.module)));
});
