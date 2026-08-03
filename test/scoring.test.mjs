// test/scoring.test.mjs
// Unit tests for the pure scoring core. Run with:  node --test
// Zero external dependencies — Node built-in test runner + assert only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  round,
  pixelsPerMm,
  snellenLetterHeightPx,
  acuityScore,
  tallyColorTest,
  astigmatismResult,
  contrastThreshold,
  summarize,
  SNELLEN_LINES,
  CREDIT_CARD_WIDTH_MM,
  DISCLAIMER,
} from '../scoring.mjs';

// --- helpers ---------------------------------------------------------------

test('round: rounds to given decimals and passes through non-finite', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(2 / 3, 3), 0.667);
  assert.equal(round(Infinity), Infinity);
  assert.ok(Number.isNaN(round(NaN)));
});

// --- calibration -----------------------------------------------------------

test('pixelsPerMm: derives from card width', () => {
  assert.equal(pixelsPerMm(CREDIT_CARD_WIDTH_MM), 1); // width==mm -> 1 px/mm
  assert.equal(round(pixelsPerMm(321), 4), round(321 / CREDIT_CARD_WIDTH_MM, 4));
});

test('pixelsPerMm: rejects non-positive input', () => {
  assert.throws(() => pixelsPerMm(0), RangeError);
  assert.throws(() => pixelsPerMm(-5), RangeError);
  assert.throws(() => pixelsPerMm('x'), TypeError);
});

// --- optotype geometry -----------------------------------------------------

test('snellenLetterHeightPx: matches independently computed value', () => {
  // MAR=1 arcmin, 6 m, 1 px/mm. letter = 5 arcmin.
  // rad = 5 * PI / (180*60); height_mm = 6000 * tan(rad)
  const rad = (5 * Math.PI) / (180 * 60);
  const expected = 6000 * Math.tan(rad); // == px because ppmm = 1
  const got = snellenLetterHeightPx({ marArcmin: 1, distanceM: 6, pixelsPerMm: 1 });
  assert.ok(Math.abs(got - expected) < 1e-9, `got ${got} expected ${expected}`);
  assert.ok(got > 0);
});

test('snellenLetterHeightPx: scales linearly with distance and ppmm', () => {
  const base = snellenLetterHeightPx({ marArcmin: 1, distanceM: 3, pixelsPerMm: 2 });
  const twiceDist = snellenLetterHeightPx({ marArcmin: 1, distanceM: 6, pixelsPerMm: 2 });
  const twicePpmm = snellenLetterHeightPx({ marArcmin: 1, distanceM: 3, pixelsPerMm: 4 });
  assert.ok(Math.abs(twiceDist - 2 * base) < 1e-6);
  assert.ok(Math.abs(twicePpmm - 2 * base) < 1e-9);
});

test('snellenLetterHeightPx: rejects bad input', () => {
  assert.throws(() => snellenLetterHeightPx({ marArcmin: 0, distanceM: 3, pixelsPerMm: 1 }), RangeError);
});

// --- acuity ----------------------------------------------------------------

test('acuityScore: at design distance the 20/40 line reads 20/40', () => {
  const idx = SNELLEN_LINES.findIndex((l) => l.snellen === '20/40');
  const r = acuityScore({ lineIndex: idx, actualDistanceM: 3, designDistanceM: 3 });
  assert.equal(r.snellen, '20/40');
  assert.equal(r.snellenDenominator, 40);
  assert.equal(r.band, 'mildly-reduced');
  assert.equal(round(r.logMAR, 3), round(Math.log10(2), 3)); // MAR 2 -> logMAR .301
});

test('acuityScore: 20/20 line at design distance is typical, logMAR 0', () => {
  const idx = SNELLEN_LINES.findIndex((l) => l.snellen === '20/20');
  const r = acuityScore({ lineIndex: idx, actualDistanceM: 3, designDistanceM: 3 });
  assert.equal(r.snellen, '20/20');
  assert.equal(r.logMAR, 0);
  assert.equal(r.band, 'typical');
});

test('acuityScore: standing closer than design halves the denominator', () => {
  const idx = SNELLEN_LINES.findIndex((l) => l.snellen === '20/40'); // MAR 2
  // actual 1.5 m vs design 3 m -> scale 2 -> effMAR 4 -> 20/80
  const r = acuityScore({ lineIndex: idx, actualDistanceM: 1.5, designDistanceM: 3 });
  assert.equal(r.snellenDenominator, 80);
  assert.equal(round(r.logMAR, 3), round(Math.log10(4), 3));
});

test('acuityScore: lineIndex -1 is inconclusive, not an error', () => {
  const r = acuityScore({ lineIndex: -1, actualDistanceM: 3 });
  assert.equal(r.readable, false);
  assert.equal(r.band, 'inconclusive');
});

test('acuityScore: out-of-range index and bad distance throw', () => {
  assert.throws(() => acuityScore({ lineIndex: 999, actualDistanceM: 3 }), RangeError);
  assert.throws(() => acuityScore({ lineIndex: 0, actualDistanceM: 0 }), RangeError);
});

test('acuityScore: a non-integer lineIndex is a clean RangeError, not an opaque TypeError', () => {
  // Regression: an in-range fractional index used to index SNELLEN_LINES as
  // undefined and blow up with "Cannot read properties of undefined".
  assert.throws(() => acuityScore({ lineIndex: 2.5, actualDistanceM: 3 }), RangeError);
  assert.throws(() => acuityScore({ lineIndex: 0.1, actualDistanceM: 3 }), RangeError);
});

test('acuityScore: a huge viewing distance never produces a degenerate 20/0', () => {
  // Regression: at very large distances 20 * effectiveMAR rounds down to 0,
  // which used to emit the malformed Snellen "20/0". Denominator floors at 1.
  const idx = SNELLEN_LINES.findIndex((l) => l.snellen === '20/10'); // MAR 0.5
  const r = acuityScore({ lineIndex: idx, actualDistanceM: 300, designDistanceM: 3 });
  assert.ok(r.snellenDenominator >= 1, `denominator ${r.snellenDenominator} must be >= 1`);
  assert.equal(r.snellen, '20/1');
  assert.ok(!r.snellen.endsWith('/0'), 'must never render 20/0');
});

// --- colour vision ---------------------------------------------------------

const PLATES = [
  { answer: '12', control: true },
  { answer: '8' },
  { answer: '6' },
  { answer: '29' },
  { answer: '57' },
  { answer: '5' },
  { answer: '3' },
  { answer: '15' },
];

test('tallyColorTest: all correct -> typical, no flag', () => {
  const responses = ['12', '8', '6', '29', '57', '5', '3', '15'];
  const r = tallyColorTest(PLATES, responses);
  assert.equal(r.total, 8);
  assert.equal(r.correct, 8);
  assert.equal(r.correctRatio, 1);
  assert.equal(r.band, 'typical');
  assert.equal(r.flaggedForReview, false);
  assert.equal(r.controlFailed, false);
});

test('tallyColorTest: normalises blanks/none and mixed case', () => {
  const responses = [' 12 ', 'none', '', 'nothing', '57', 'FIVE', '3', '15'];
  const r = tallyColorTest(PLATES, responses);
  // correct: plate0(12), plate4(57), plate6(3), plate7(15) = 4
  assert.equal(r.correct, 4);
  assert.equal(r.correctRatio, 0.5);
  assert.equal(r.band, 'possible-deficiency');
  assert.equal(r.flaggedForReview, true);
});

test('tallyColorTest: failing the control plate is inconclusive', () => {
  const responses = ['99', '8', '6', '29', '57', '5', '3', '15']; // control wrong
  const r = tallyColorTest(PLATES, responses);
  assert.equal(r.controlFailed, true);
  assert.equal(r.band, 'inconclusive');
  assert.equal(r.flaggedForReview, true);
});

test('tallyColorTest: mostly wrong -> significant-difference', () => {
  const responses = ['12', 'x', 'x', 'x', 'x', 'x', 'x', 'x']; // only control right
  const r = tallyColorTest(PLATES, responses);
  assert.equal(r.correct, 1);
  assert.equal(r.band, 'significant-difference');
});

test('tallyColorTest: rejects bad input shapes', () => {
  assert.throws(() => tallyColorTest('nope', []), TypeError);
  assert.throws(() => tallyColorTest([], []), RangeError);
});

test('tallyColorTest: partial responses (fewer than plates) count missing ones as blank', () => {
  // Edge case: the user quits early / the responses array is short. Missing
  // entries must be treated as blank answers, not crash on undefined.
  const responses = ['12']; // only the control plate answered
  const r = tallyColorTest(PLATES, responses);
  assert.equal(r.total, 8);
  assert.equal(r.correct, 1); // just the control
  assert.equal(r.controlFailed, false); // control was answered correctly
  assert.equal(r.band, 'significant-difference');
});

test('tallyColorTest: a completely empty response set is inconclusive via the control', () => {
  const r = tallyColorTest(PLATES, []);
  assert.equal(r.correct, 0);
  assert.equal(r.correctRatio, 0);
  assert.equal(r.controlFailed, true);
  assert.equal(r.band, 'inconclusive');
});

// --- astigmatism -----------------------------------------------------------

test('astigmatismResult: empty report -> typical', () => {
  const r = astigmatismResult([]);
  assert.equal(r.indicatesAstigmatism, false);
  assert.equal(r.band, 'typical');
  assert.deepEqual(r.axes, []);
});

test('astigmatismResult: reported axes -> possible astigmatism, deduped/sorted', () => {
  const r = astigmatismResult([90, 90, 0]);
  assert.equal(r.indicatesAstigmatism, true);
  assert.equal(r.band, 'possible-astigmatism');
  assert.deepEqual(r.axes, [0, 90]);
});

test('astigmatismResult: rejects out-of-range axes', () => {
  assert.throws(() => astigmatismResult([200]), RangeError);
  assert.throws(() => astigmatismResult('x'), TypeError);
});

// --- contrast --------------------------------------------------------------

test('contrastThreshold: leading correct run sets the threshold', () => {
  const items = [
    { contrast: 0.5, correct: true },
    { contrast: 0.25, correct: true },
    { contrast: 0.12, correct: true },
    { contrast: 0.06, correct: false },
    { contrast: 0.03, correct: false },
  ];
  const r = contrastThreshold(items);
  assert.equal(r.thresholdContrast, 0.12);
  assert.equal(r.logCS, round(Math.log10(1 / 0.12), 3));
  assert.equal(r.band, 'reduced'); // logCS ~0.92
});

test('contrastThreshold: a later correct after a miss does not count', () => {
  const items = [
    { contrast: 0.5, correct: true },
    { contrast: 0.25, correct: false },
    { contrast: 0.12, correct: true }, // ignored: run already broken
  ];
  const r = contrastThreshold(items);
  assert.equal(r.thresholdContrast, 0.5);
});

test('contrastThreshold: high logCS is typical', () => {
  const items = [
    { contrast: 0.5, correct: true },
    { contrast: 0.1, correct: true },
    { contrast: 0.01, correct: true }, // logCS = 2.0
  ];
  const r = contrastThreshold(items);
  assert.equal(r.thresholdContrast, 0.01);
  assert.equal(r.band, 'typical');
});

test('contrastThreshold: missing the top target is inconclusive', () => {
  const items = [{ contrast: 0.5, correct: false }];
  const r = contrastThreshold(items);
  assert.equal(r.thresholdContrast, null);
  assert.equal(r.band, 'inconclusive');
});

test('contrastThreshold: rejects out-of-range contrast', () => {
  assert.throws(() => contrastThreshold([{ contrast: 2, correct: true }]), RangeError);
  assert.throws(() => contrastThreshold([]), TypeError);
});

// --- summary ---------------------------------------------------------------

test('summarize: no flags -> reassuring but still recommends exams', () => {
  const s = summarize({
    acuity: { band: 'typical', note: 'ok' },
    color: { flaggedForReview: false, note: 'ok' },
    astigmatism: { indicatesAstigmatism: false, note: 'ok' },
    contrast: { band: 'typical', note: 'ok' },
  });
  assert.equal(s.anyFlags, false);
  assert.equal(s.flags.length, 0);
  assert.equal(s.lines.length, 4);
  assert.match(s.recommendation, /routine professional eye exams/i);
  assert.equal(s.disclaimer, DISCLAIMER);
});

test('summarize: any flag surfaces and urges an appointment', () => {
  const s = summarize({
    acuity: { band: 'moderately-reduced', note: 'reduced' },
    color: { flaggedForReview: true, note: 'diff' },
  });
  assert.equal(s.anyFlags, true);
  assert.deepEqual(s.flags.sort(), ['acuity', 'color']);
  assert.match(s.recommendation, /optometrist or ophthalmologist/i);
});

test('summarize: empty input still returns a disclaimer', () => {
  const s = summarize();
  assert.equal(s.lines.length, 0);
  assert.equal(s.disclaimer, DISCLAIMER);
});

test('DISCLAIMER: states it is not a medical device', () => {
  assert.match(DISCLAIMER, /not a medical device/i);
  assert.match(DISCLAIMER, /optometrist or ophthalmologist/i);
});
