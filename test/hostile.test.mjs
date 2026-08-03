// hostile.test.mjs
// The fail-loud contract in one place: every public scoring function throws on
// malformed input (never a silent wrong guess), and the aggregators degrade
// safely on an empty session.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as scoring from '../scoring.mjs';

const THROWERS = [
  ['pixelsPerMm', [-1]],
  ['pixelsPerMm', [NaN]],
  ['snellenLetterHeightPx', [{ marArcmin: -1, distanceM: 1, pixelsPerMm: 1 }]],
  ['acuityScore', [{ lineIndex: 1.5, actualDistanceM: 3 }]],
  ['acuityScore', [{ lineIndex: 99, actualDistanceM: 3 }]],
  ['nearAcuityScore', [{ lineIndex: 'x', actualDistanceM: 0.4 }]],
  ['tallyColorTest', ['x', []]],
  ['tallyColorTest', [[], []]],
  ['classifyColorTendency', ['x', []]],
  ['classifyColorTendency', [[], []]],
  ['astigmatismResult', ['x']],
  ['astigmatismResult', [[200]]],
  ['contrastThreshold', [[]]],
  ['contrastThreshold', [[{ contrast: 2, correct: true }]]],
  ['staircaseThreshold', ['x']],
  ['staircaseThreshold', [[]]],
  ['compareEyes', ['badmodule', {}, {}]],
  ['compareEyes', ['acuity', null, {}]],
  ['labelEye', [{}, 'middle']],
  ['labelEye', [42, 'left']],
  ['assessReliability', [null]],
  ['assessReliability', [42]],
  ['buildReport', [null]],
  ['buildReport', [{}, { generatedAt: 42 }]],
  ['serializeSession', [null]],
  ['deserializeSession', [{ schemaVersion: '999', modules: {} }]],
  ['deserializeSession', [null]],
  ['compareSessions', [null, {}]],
];

for (const [fn, args] of THROWERS) {
  test(`hostile: ${fn} throws on ${JSON.stringify(args)}`, () => {
    assert.throws(() => scoring[fn](...args));
  });
}

test('degrade-safe: summarize + buildReport handle an empty session without crashing', () => {
  assert.equal(typeof scoring.summarize({}).disclaimer, 'string');
  assert.equal(scoring.buildReport({}).disclaimer, scoring.DISCLAIMER);
});

test('hostile: null array elements throw a curated message, not an engine crash', () => {
  assert.throws(() => scoring.tallyColorTest([null], ['x']), /plate 0 must be an object/);
  assert.throws(() => scoring.classifyColorTendency([null], ['x']), /plate 0 must be an object/);
  assert.throws(() => scoring.contrastThreshold([null]), /item 0 must be an object/);
});

test('hostile: a null opts argument is treated as defaults, not a crash', () => {
  assert.doesNotThrow(() => scoring.buildReport({}, null));
  assert.doesNotThrow(() => scoring.serializeSession({}, null));
  assert.doesNotThrow(() =>
    scoring.staircaseThreshold(
      [{ level: 1, correct: true }, { level: 0.5, correct: true }, { level: 1, correct: false }],
      null,
    ),
  );
});

test('round: throws on a non-number, but NaN/Infinity still pass through', () => {
  assert.throws(() => scoring.round('5'), TypeError);
  assert.equal(scoring.round(Infinity), Infinity);
  assert.ok(Number.isNaN(scoring.round(NaN)));
});
