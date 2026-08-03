// persistence.test.mjs
// Step 7: PII-free local save/compare serialization. The payload the app stores
// in localStorage carries NO identity data, and compareSessions shows an
// educational trend only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acuityScore,
  classifyColorTendency,
  compareSessions,
  deserializeSession,
  serializeSession,
} from '../scoring.mjs';
import { buildConfusionPlateSet } from '../plates.mjs';

function makeSession() {
  return {
    acuity: acuityScore({ lineIndex: 0, actualDistanceM: 3 }), // notably-reduced
    pixelsPerMm: 5,
    viewingDistanceM: 3,
  };
}

test('serializeSession: round-trips through deserialize and JSON', () => {
  const s = serializeSession(makeSession());
  assert.deepEqual(deserializeSession(s), s);
  assert.deepEqual(deserializeSession(JSON.parse(JSON.stringify(s))), s);
});

test('serializeSession: the payload is PII-free (exact top-level key set)', () => {
  const s = serializeSession(makeSession(), { label: 'morning' });
  assert.deepEqual(
    Object.keys(s).sort(),
    ['calibration', 'label', 'modules', 'savedAt', 'schemaVersion'],
  );
  // Only known module names, and only primitive fields inside.
  for (const [name, fields] of Object.entries(s.modules)) {
    assert.ok(['acuity', 'nearAcuity', 'color', 'colorTendency', 'astigmatism', 'contrast', 'reliability'].includes(name));
    for (const v of Object.values(fields)) {
      assert.ok(['string', 'number', 'boolean'].includes(typeof v));
    }
  }
  // Calibration is numbers only.
  for (const v of Object.values(s.calibration)) assert.equal(typeof v, 'number');
});

test('serializeSession: only whitelisted numeric calibration is kept', () => {
  const s = serializeSession({ pixelsPerMm: 5, secretName: 'Alice', token: 'abc' });
  assert.deepEqual(Object.keys(s.calibration), ['pixelsPerMm']);
  assert.equal(JSON.stringify(s).includes('Alice'), false);
  assert.equal(JSON.stringify(s).includes('token'), false);
});

test('serializeSession: a live colour tendency keeps only the whitelisted primitive fields', () => {
  // The tendency now flows from real confusion-line plates (plates.mjs), so
  // assert the deliberate whitelist: tendency + confidence survive, while the
  // per-type tallies and prose note never enter the stored payload.
  const plates = buildConfusionPlateSet();
  const responses = plates.map((p) => (p.probes === 'protan' ? '' : p.answer));
  const colorTendency = classifyColorTendency(plates, responses);
  assert.equal(colorTendency.tendency, 'protan-leaning');
  const s = serializeSession({ colorTendency });
  assert.deepEqual(s.modules.colorTendency, { tendency: 'protan-leaning', confidence: 'moderate' });
  const raw = JSON.stringify(s);
  for (const leak of ['perType', 'missed', 'note', 'professional']) {
    assert.equal(raw.includes(leak), false, `serialized payload must not contain ${leak}`);
  }
});

test('deserializeSession: rejects a wrong or missing schema', () => {
  assert.throws(() => deserializeSession({ schemaVersion: '999', modules: {} }), RangeError);
  assert.throws(() => deserializeSession({ modules: {} }), RangeError);
  assert.throws(() => deserializeSession(null), TypeError);
});

test('compareSessions: shows better / worse / same trends', () => {
  const typical = { schemaVersion: '1.0', modules: { acuity: { band: 'typical' } } };
  const reduced = { schemaVersion: '1.0', modules: { acuity: { band: 'notably-reduced' } } };
  assert.equal(compareSessions(typical, reduced).changes.find((c) => c.module === 'acuity').direction, 'worse');
  assert.equal(compareSessions(reduced, typical).changes.find((c) => c.module === 'acuity').direction, 'better');
  assert.equal(compareSessions(typical, typical).changes.find((c) => c.module === 'acuity').direction, 'same');
  assert.ok(compareSessions(typical, reduced).note.toLowerCase().includes('professional'));
});

test('persistence: fails loud on malformed input', () => {
  assert.throws(() => serializeSession(null), TypeError);
  assert.throws(() => compareSessions(null, {}), TypeError);
});
