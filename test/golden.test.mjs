// golden.test.mjs
// Determinism tripwire: pin a sha256 of a canonical report. The report is
// text-only (notes/flags/headline), so the digest is stable across platforms
// and Node versions. Regenerate GOLDEN_DIGEST ONLY on an intentional change,
// and say why in the commit message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  acuityScore,
  assessReliability,
  astigmatismResult,
  buildReport,
  contrastThreshold,
  nearAcuityScore,
  reportToJson,
  tallyColorTest,
} from '../scoring.mjs';

const GOLDEN_DIGEST = '3d8b78b306fd4156711c67bb58774bbb814f86990dd707a2b4892704af6735c8';

function canonicalReportJson() {
  const acuity = acuityScore({ lineIndex: 5, actualDistanceM: 3 });
  const nearAcuity = nearAcuityScore({ lineIndex: 6, actualDistanceM: 0.4 });
  const color = tallyColorTest(
    [{ answer: '12', control: true }, { answer: '8' }, { answer: '6' }],
    ['12', 'x', '6'],
  );
  const contrast = contrastThreshold([
    { contrast: 0.5, correct: true },
    { contrast: 0.2, correct: false },
  ]);
  const astigmatism = astigmatismResult([90]);
  const base = { acuity, nearAcuity, color, contrast, astigmatism, pixelsPerMm: 5, viewingDistanceM: 3 };
  const session = { ...base, reliability: assessReliability(base) };
  return reportToJson(buildReport(session, { generatedAt: '2026-07-12T00:00:00Z' }));
}

test('golden: the canonical report digest is stable', () => {
  const digest = createHash('sha256').update(canonicalReportJson(), 'utf8').digest('hex');
  assert.equal(digest, GOLDEN_DIGEST);
});

test('golden: two builds are byte-identical (no wall-clock, no randomness)', () => {
  assert.equal(canonicalReportJson(), canonicalReportJson());
});
