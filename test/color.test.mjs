// color.test.mjs
// Step 2: colour-deficiency TENDENCY from type-tagged plates. Educational only —
// a leaning/tendency, NEVER a diagnosis or a definitive type.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISCLAIMER, classifyColorTendency, summarize } from '../scoring.mjs';

test('classifyColorTendency: all correct -> no tendency', () => {
  const plates = [
    { answer: '12', probes: 'protan' },
    { answer: '8', probes: 'deutan' },
    { answer: '6', probes: 'tritan' },
    { answer: '29', control: true },
  ];
  const r = classifyColorTendency(plates, ['12', '8', '6', '29']);
  assert.equal(r.tendency, 'none');
});

test('classifyColorTendency: missing the deutan-tagged plates leans deutan, honestly', () => {
  const plates = [
    { answer: '12', probes: 'protan' },
    { answer: '8', probes: 'deutan' },
    { answer: '5', probes: 'deutan' },
    { answer: '6', probes: 'tritan' },
    { answer: '29', control: true },
  ];
  const r = classifyColorTendency(plates, ['12', 'x', 'x', '6', '29']);
  assert.equal(r.tendency, 'deutan-leaning');
  assert.equal(r.confidence, 'moderate');
  assert.equal(r.perType.deutan.missed, 2);
  const note = r.note.toLowerCase();
  assert.ok(note.includes('professional'), 'points to a professional');
  assert.ok(note.includes('not a diagnosis'), 'explicitly not a diagnosis');
});

test('classifyColorTendency: misses across types are mixed, not a single type', () => {
  const plates = [
    { answer: '12', probes: 'protan' },
    { answer: '8', probes: 'deutan' },
    { answer: '6', probes: 'tritan' },
  ];
  const r = classifyColorTendency(plates, ['x', 'x', '6']);
  assert.equal(r.tendency, 'mixed');
});

test('classifyColorTendency: a failed control plate is inconclusive', () => {
  const plates = [
    { answer: '8', probes: 'deutan' },
    { answer: '29', control: true },
  ];
  const r = classifyColorTendency(plates, ['x', 'x']);
  assert.equal(r.tendency, 'inconclusive');
});

test('classifyColorTendency: no type-tagged plates is inconclusive (cannot infer a type)', () => {
  const r = classifyColorTendency([{ answer: '12' }, { answer: '8' }], ['12', '8']);
  assert.equal(r.tendency, 'inconclusive');
  assert.ok(r.note.toLowerCase().includes('professional'));
});

test('classifyColorTendency: fails loud on malformed input', () => {
  assert.throws(() => classifyColorTendency('x', []), TypeError);
  assert.throws(() => classifyColorTendency([], []), RangeError);
});

test('summarize: a colour-vision tendency folds in as a line + flag, keeping the disclaimer', () => {
  const r = classifyColorTendency(
    [{ answer: '8', probes: 'deutan' }, { answer: '5', probes: 'deutan' }],
    ['x', 'x'],
  );
  const s = summarize({ colorTendency: r });
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.ok(s.flags.includes(`colorTendency:${r.tendency}`));
  assert.ok(s.lines.some((l) => /colour-vision tendency/i.test(l.module)));
});
