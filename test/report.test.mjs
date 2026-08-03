// report.test.mjs
// Step 6: portable, DETERMINISTIC session report. No wall-clock; the timestamp
// is injected. Every rendering embeds the canonical DISCLAIMER.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCLAIMER,
  acuityScore,
  assessReliability,
  buildReport,
  reportToJson,
  reportToText,
} from '../scoring.mjs';

const TS = '2026-01-01T00:00:00Z';

function makeSession() {
  const acuity = acuityScore({ lineIndex: 0, actualDistanceM: 3 }); // notably-reduced
  return { acuity, reliability: assessReliability({ acuity }) };
}

test('buildReport + reportToJson: same session + injected timestamp -> byte-identical', () => {
  const s = makeSession();
  assert.equal(reportToJson(buildReport(s, { generatedAt: TS })), reportToJson(buildReport(s, { generatedAt: TS })));
});

test('buildReport: no timestamp means no wall-clock -> deterministic and generatedAt null', () => {
  const s = makeSession();
  assert.equal(reportToJson(buildReport(s)), reportToJson(buildReport(s)));
  assert.equal(buildReport(s).generatedAt, null);
});

test('buildReport: an injected timestamp is recorded verbatim', () => {
  assert.equal(buildReport(makeSession(), { generatedAt: TS }).generatedAt, TS);
});

test('report embeds the DISCLAIMER in JSON and text, honestly', () => {
  const r = buildReport(makeSession());
  assert.equal(JSON.parse(reportToJson(r)).disclaimer, DISCLAIMER);
  assert.ok(reportToText(r).includes(DISCLAIMER));
  const low = DISCLAIMER.toLowerCase();
  assert.ok(low.includes('not a medical device'));
  assert.ok(low.includes('professional'));
});

test('report reflects flags from the session', () => {
  const r = buildReport(makeSession());
  assert.equal(r.anyFlags, true);
  assert.ok(r.flags.includes('acuity'));
});

test('reportToText renders a readable report', () => {
  const text = reportToText(buildReport(makeSession(), { generatedAt: TS }));
  assert.ok(text.includes('VisionCheckR'));
  assert.ok(text.includes(TS));
  assert.ok(text.includes('Recommendation'));
});

test('buildReport: fails loud on malformed input', () => {
  assert.throws(() => buildReport(null), TypeError);
  assert.throws(() => buildReport([]), TypeError);
  assert.throws(() => buildReport({}, { generatedAt: 42 }), TypeError);
});
