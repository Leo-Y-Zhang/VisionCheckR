// reliability.test.mjs
// Step 5: whole-run reliability/quality assessment. An unreliable run is
// INCONCLUSIVE, never dressed up as a result.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISCLAIMER, assessReliability, summarize } from '../scoring.mjs';

test('assessReliability: a clean full session is reliable', () => {
  const r = assessReliability({
    pixelsPerMm: 5,
    viewingDistanceM: 3,
    acuity: { band: 'typical' },
    color: { controlFailed: false },
    contrast: { band: 'typical' },
  });
  assert.equal(r.band, 'reliable');
  assert.equal(r.reliable, true);
  assert.equal(r.issues.length, 0);
  assert.ok(r.note.toLowerCase().includes('professional'));
});

test('assessReliability: a colour control failure is flagged; other data keeps it partial', () => {
  const r = assessReliability({ acuity: { band: 'typical' }, color: { controlFailed: true } });
  assert.equal(r.band, 'partial');
  assert.ok(r.issues.some((i) => i.module === 'color'));
});

test('assessReliability: a colour-only run that fails control is unreliable', () => {
  assert.equal(assessReliability({ color: { controlFailed: true } }).band, 'unreliable');
});

test('assessReliability: implausible calibration makes the run unreliable', () => {
  const r = assessReliability({ pixelsPerMm: 0.1, acuity: { band: 'typical' } });
  assert.equal(r.band, 'unreliable');
  assert.ok(r.issues.some((i) => i.module === 'calibration'));
});

test('assessReliability: one inconclusive module among usable ones is partial', () => {
  assert.equal(
    assessReliability({ acuity: { band: 'typical' }, contrast: { inconclusive: true } }).band,
    'partial',
  );
});

test('assessReliability: an empty session is unreliable, not a crash', () => {
  const r = assessReliability({});
  assert.equal(r.band, 'unreliable');
  assert.equal(r.reliable, false);
});

test('assessReliability: fails loud on a non-object session', () => {
  assert.throws(() => assessReliability(null), TypeError);
  assert.throws(() => assessReliability([]), TypeError);
  assert.throws(() => assessReliability(42), TypeError);
});

test('summarize: reliability folds in as a line + flag when not reliable', () => {
  const rel = assessReliability({});
  const s = summarize({ reliability: rel });
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.ok(s.flags.includes(`reliability:${rel.band}`));
  assert.ok(s.lines.some((l) => /reliability/i.test(l.module)));
});

test('assessReliability: the calibration plausibility ranges are [1, 30] px/mm and [0.2, 6] m', () => {
  const band = (s) => assessReliability({ acuity: { band: 'typical' }, ...s }).band;
  assert.equal(band({ pixelsPerMm: 1 }), 'reliable');
  assert.equal(band({ pixelsPerMm: 30 }), 'reliable');
  assert.equal(band({ pixelsPerMm: 0.8 }), 'unreliable');
  assert.equal(band({ pixelsPerMm: 31 }), 'unreliable');
  assert.equal(band({ viewingDistanceM: 0.2 }), 'reliable');
  assert.equal(band({ viewingDistanceM: 6 }), 'reliable');
  assert.equal(band({ viewingDistanceM: 0.19 }), 'unreliable');
  assert.equal(band({ viewingDistanceM: 8 }), 'unreliable');
});

test('assessReliability: an inconclusive colour tendency on its own marks the colour run', () => {
  const r = assessReliability({ acuity: { band: 'typical' }, colorTendency: { tendency: 'inconclusive' } });
  assert.equal(r.band, 'partial');
  assert.ok(r.issues.some((i) => i.module === 'color'));
});

test('summarize: a partial run is flagged, not only an unreliable one', () => {
  const rel = assessReliability({ acuity: { band: 'typical' }, contrast: { inconclusive: true } });
  assert.equal(rel.band, 'partial');
  assert.ok(summarize({ reliability: rel }).flags.includes('reliability:partial'));
});
