// eyes.test.mjs
// Step 1: per-eye labelling + interocular asymmetry (pure, additive).
// Honesty: a between-eye difference is "worth mentioning to a professional",
// NEVER a diagnosis.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCLAIMER,
  acuityScore,
  compareEyes,
  labelEye,
  summarize,
} from '../scoring.mjs';

// --- labelEye ---

test('labelEye: attaches an eye label without mutating the source', () => {
  const base = acuityScore({ lineIndex: 7, actualDistanceM: 3 });
  const labelled = labelEye(base, 'left');
  assert.equal(labelled.eye, 'left');
  assert.equal(base.eye, undefined); // source untouched
  assert.equal(labelled.snellen, base.snellen);
});

test('labelEye: rejects an unknown eye value', () => {
  assert.throws(() => labelEye({}, 'middle'), RangeError);
});

test('labelEye: rejects a non-object result', () => {
  assert.throws(() => labelEye(42, 'left'), TypeError);
});

// --- compareEyes: acuity (logMAR) ---

test('compareEyes: near-equal eyes are symmetric, not flagged', () => {
  const cmp = compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.1 });
  assert.equal(cmp.comparable, true);
  assert.equal(cmp.asymmetric, false);
  assert.equal(cmp.band, 'symmetric');
});

test('compareEyes: a clear left/right acuity gap is flagged, honestly', () => {
  const cmp = compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.3 });
  assert.equal(cmp.asymmetric, true);
  assert.equal(cmp.band, 'notable-asymmetry');
  assert.equal(cmp.delta, 0.3);
  const note = cmp.note.toLowerCase();
  assert.ok(note.includes('professional'), 'points to a professional');
  assert.ok(note.includes('not a diagnosis'), 'explicitly not a diagnosis');
});

test('compareEyes: threshold boundary is inclusive (>= is notable)', () => {
  assert.equal(compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.2 }).asymmetric, true);
  assert.equal(compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.19 }).asymmetric, false);
});

// --- compareEyes: contrast (logCS) ---

test('compareEyes: contrast asymmetry uses logCS', () => {
  const cmp = compareEyes('contrast', { logCS: 1.8 }, { logCS: 1.4 });
  assert.equal(cmp.asymmetric, true);
  assert.equal(cmp.delta, 0.4);
  assert.equal(cmp.unit, 'logCS');
});

// --- compareEyes: honest degrade + fail-loud ---

test('compareEyes: an inconclusive eye is not comparable, never guessed', () => {
  const cmp = compareEyes('acuity', { logMAR: 0.0 }, { band: 'inconclusive' });
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.asymmetric, false);
  assert.equal(cmp.band, 'inconclusive');
});

test('compareEyes: unsupported module throws', () => {
  assert.throws(() => compareEyes('astigmatism', {}, {}), RangeError);
});

test('compareEyes: non-object eyes throw', () => {
  assert.throws(() => compareEyes('acuity', null, { logMAR: 0 }), TypeError);
});

// --- summarize folds in the comparison ---

test('summarize: a flagged asymmetry adds a line + flag and keeps the disclaimer', () => {
  const cmp = compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.4 });
  const s = summarize({
    acuity: acuityScore({ lineIndex: 7, actualDistanceM: 3 }),
    eyeComparisons: [cmp],
  });
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.equal(s.anyFlags, true);
  assert.ok(s.flags.includes('asymmetry:acuity'));
  assert.ok(s.lines.some((l) => /between-eye/i.test(l.module)));
});

test('summarize: a symmetric comparison adds a line but no flag', () => {
  const cmp = compareEyes('acuity', { logMAR: 0.0 }, { logMAR: 0.05 });
  const s = summarize({ eyeComparisons: [cmp] });
  assert.equal(s.flags.includes('asymmetry:acuity'), false);
  assert.ok(s.lines.some((l) => /between-eye/i.test(l.module)));
});
