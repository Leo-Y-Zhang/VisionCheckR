// plates.test.mjs
// Deterministic confusion-line colour plates (plates.mjs). The generator is
// PURE: no DOM, no image assets, no wall clock and no Math.random — the only
// entropy is the injected seed, so identical inputs must yield byte-identical
// plates. The colours must GENUINELY sit on the protan/deutan/tritan confusion
// lines at matched luminance (verified here by converting the emitted sRGB hex
// back to chromaticity), and the canonical set must activate the scoring
// core's classifyColorTendency. Educational approximation only — these are not
// a certified Ishihara set and nothing derived from them is a diagnosis.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COPUNCTAL_POINTS,
  PLATE_KINDS,
  buildConfusionPlateSet,
  digitCells,
  generatePlate,
  isInDigit,
  platePalette,
  srgbHexToXyy,
  xyYToSrgbHex,
} from '../plates.mjs';
import { classifyColorTendency, tallyColorTest } from '../scoring.mjs';

const CONFUSION_TYPES = ['protan', 'deutan', 'tritan'];

// Distance of point p from the infinite line through a and b (chromaticity
// space). Used to check the palette pair really lies on a confusion line.
function pointToLineDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  return Math.abs(abx * apy - aby * apx) / Math.sqrt(abx * abx + aby * aby);
}

// --- determinism -------------------------------------------------------------

test('generatePlate: identical inputs give byte-identical plates', () => {
  const a = generatePlate({ kind: 'protan', answer: '74', seed: 7 });
  const b = generatePlate({ kind: 'protan', answer: '74', seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('generatePlate: a different seed gives a different dot layout', () => {
  const a = generatePlate({ kind: 'deutan', answer: '8', seed: 1 });
  const b = generatePlate({ kind: 'deutan', answer: '8', seed: 2 });
  assert.notEqual(JSON.stringify(a.dots), JSON.stringify(b.dots));
});

// --- structure ---------------------------------------------------------------

test('generatePlate: every dot is a plain value inside the plate disc', () => {
  const plate = generatePlate({ kind: 'tritan', answer: '15', seed: 11 });
  assert.ok(plate.dots.length > 300, 'a plate is densely dotted');
  for (const dot of plate.dots) {
    assert.deepEqual(Object.keys(dot).sort(), ['color', 'r', 'role', 'x', 'y']);
    assert.ok(dot.r > 0, 'radius positive');
    assert.match(dot.color, /^#[0-9a-f]{6}$/);
    assert.ok(['figure', 'ground'].includes(dot.role));
    const d = Math.sqrt((dot.x - 0.5) ** 2 + (dot.y - 0.5) ** 2);
    assert.ok(d + dot.r <= 0.4801, `dot at ${dot.x},${dot.y} stays inside the disc`);
  }
});

test('generatePlate: figure dots trace the digit and ground dots stay outside it', () => {
  const plate = generatePlate({ kind: 'protan', answer: '29', seed: 3 });
  let figures = 0;
  for (const dot of plate.dots) {
    if (dot.role === 'figure') {
      figures++;
      assert.equal(isInDigit('29', dot.x, dot.y), true, 'figure dot inside the digit mask');
    } else {
      assert.equal(isInDigit('29', dot.x, dot.y), false, 'ground dot outside the digit mask');
    }
  }
  assert.ok(figures >= 30, 'the digit is actually covered with figure dots');
});

test('generatePlate: dot colours come only from the plate palette for its kind', () => {
  const plate = generatePlate({ kind: 'deutan', answer: '5', seed: 9 });
  const palette = platePalette('deutan');
  for (const dot of plate.dots) {
    assert.ok(palette[dot.role].includes(dot.color), `${dot.role} colour from its ramp`);
  }
});

// --- anti-leak: the geometry is digit-blind ----------------------------------
// An adversarial review of the first design showed the digit could be
// reconstructed from GEOMETRY alone (oversized figure-only anchor dots plus a
// dot-free margin along the contour) — a false-negative trap for exactly the
// colour-deficient users the plates probe. The fix makes dot positions and
// radii a pure function of (seed, dotCount): these tests pin that invariant.

test('anti-leak: same seed and dotCount give identical geometry whatever the digit or kind', () => {
  const geometryOf = (p) => JSON.stringify(p.dots.map(({ x, y, r }) => [x, y, r]));
  const a = generatePlate({ kind: 'deutan', answer: '8', seed: 42 });
  const b = generatePlate({ kind: 'deutan', answer: '74', seed: 42 });
  const c = generatePlate({ kind: 'tritan', answer: '3', seed: 42 });
  const d = generatePlate({ kind: 'control', answer: '12', seed: 42 });
  assert.equal(geometryOf(a), geometryOf(b), 'answer must not shape the geometry');
  assert.equal(geometryOf(b), geometryOf(c), 'kind must not shape the geometry');
  assert.equal(geometryOf(c), geometryOf(d), 'control plates share the same layout law');
});

test('anti-leak: no dot-size filter separates figure from ground', () => {
  // The reviewed attack: "keep only the biggest dots" traced the digit because
  // figure anchors out-sized every ground dot. Now the top-decile-radius dots
  // must contain figure dots in about the same proportion as the whole plate
  // (tolerance 0.12 = 3 sigma of binomial noise on a ~85-dot decile; the
  // plates are deterministic, so the observed worst case 0.089 never moves),
  // and the per-role MEAN radius must agree far more tightly.
  for (const plate of buildConfusionPlateSet()) {
    const sorted = [...plate.dots].sort((p, q) => q.r - p.r);
    const decile = sorted.slice(0, Math.ceil(sorted.length / 10));
    const figFrac = (dots) => dots.filter((d) => d.role === 'figure').length / dots.length;
    assert.ok(Math.abs(figFrac(decile) - figFrac(plate.dots)) < 0.12,
      `${plate.kind}/${plate.answer}: biggest dots are not disproportionately one role`);
    const radii = (role) => plate.dots.filter((d) => d.role === role).map((d) => d.r);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(Math.abs(mean(radii('figure')) - mean(radii('ground'))) < 0.001,
      `${plate.kind}/${plate.answer}: mean dot radius matches across roles`);
    const maxFig = Math.max(...radii('figure'));
    const maxGnd = Math.max(...radii('ground'));
    assert.ok(Math.abs(maxFig - maxGnd) < 0.003,
      `${plate.kind}/${plate.answer}: neither role owns the largest dots`);
  }
});

test('legibility: every stroke cell of every shipped plate contains figure dots', () => {
  for (const plate of buildConfusionPlateSet()) {
    for (const cell of digitCells(plate.answer)) {
      const inCell = plate.dots.filter((d) => d.role === 'figure'
        && d.x >= cell.left && d.x < cell.left + cell.size
        && d.y >= cell.top && d.y < cell.top + cell.size);
      assert.ok(inCell.length >= 2,
        `${plate.kind}/${plate.answer}: stroke cell at ${cell.left},${cell.top} has ${inCell.length} figure dots`);
    }
  }
});

// --- colour science: the plates genuinely use confusion-line pairs ------------

test('palette: figure/ground chromaticities lie on the confusion line of their type', () => {
  for (const type of CONFUSION_TYPES) {
    const palette = platePalette(type);
    // Recover chromaticity from the EMITTED hex (round-trip through 8-bit sRGB),
    // so this checks what the screen actually shows, not just the input numbers.
    const fig = srgbHexToXyy(palette.figure[1]);
    const gnd = srgbHexToXyy(palette.ground[1]);
    const chromaSep = Math.sqrt((fig.x - gnd.x) ** 2 + (fig.y - gnd.y) ** 2);
    assert.ok(chromaSep >= 0.05, `${type}: a clear chromatic signal for typical vision`);
    const dist = pointToLineDistance(COPUNCTAL_POINTS[type], fig, gnd);
    assert.ok(dist < 0.08, `${type}: figure-ground line passes near the copunctal point (dist ${dist})`);
  }
});

test('palette: figure and ground are luminance-matched so brightness is no cue', () => {
  for (const type of CONFUSION_TYPES) {
    const palette = platePalette(type);
    assert.equal(palette.figure.length, palette.ground.length);
    for (let i = 0; i < palette.figure.length; i++) {
      const yf = srgbHexToXyy(palette.figure[i]).Y;
      const yg = srgbHexToXyy(palette.ground[i]).Y;
      assert.ok(Math.abs(yf - yg) <= 0.02, `${type} ramp ${i}: |dY| = ${Math.abs(yf - yg)}`);
    }
  }
});

test('palette: the three confusion axes point in distinct directions', () => {
  const axes = CONFUSION_TYPES.map((type) => {
    const palette = platePalette(type);
    const fig = srgbHexToXyy(palette.figure[1]);
    const gnd = srgbHexToXyy(palette.ground[1]);
    const dx = fig.x - gnd.x;
    const dy = fig.y - gnd.y;
    const n = Math.sqrt(dx * dx + dy * dy);
    return { type, x: dx / n, y: dy / n };
  });
  for (let i = 0; i < axes.length; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      const cos = Math.abs(axes[i].x * axes[j].x + axes[i].y * axes[j].y);
      assert.ok(cos < Math.cos((10 * Math.PI) / 180),
        `${axes[i].type} vs ${axes[j].type} axes differ by more than 10 degrees`);
    }
  }
});

test('palette: the control plate is readable by luminance alone', () => {
  const palette = platePalette('control');
  const figMax = Math.max(...palette.figure.map((h) => srgbHexToXyy(h).Y));
  const gndMin = Math.min(...palette.ground.map((h) => srgbHexToXyy(h).Y));
  assert.ok(gndMin - figMax >= 0.15, 'a clear luminance gap everyone can see');
});

test('xyY conversion: round-trips within quantization error and rejects out-of-gamut', () => {
  const hex = xyYToSrgbHex({ x: 0.33, y: 0.33, Y: 0.35 });
  const back = srgbHexToXyy(hex);
  assert.ok(Math.abs(back.x - 0.33) < 0.01);
  assert.ok(Math.abs(back.y - 0.33) < 0.01);
  assert.ok(Math.abs(back.Y - 0.35) < 0.01);
  assert.throws(() => xyYToSrgbHex({ x: 0.7, y: 0.28, Y: 0.4 }), RangeError);
  assert.throws(() => xyYToSrgbHex({ x: 0.33, y: 'x', Y: 0.3 }), TypeError);
});

// --- fail-loud validation ------------------------------------------------------

test('generatePlate: fails loud on malformed input', () => {
  assert.throws(() => generatePlate({ kind: 'rhodopsin', answer: '8', seed: 1 }), RangeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: 8, seed: 1 }), TypeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: '123', seed: 1 }), RangeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: 'ab', seed: 1 }), RangeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: '8', seed: 'x' }), TypeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: '8', seed: -1 }), RangeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: '8', seed: 1.5 }), RangeError);
  assert.throws(() => generatePlate({ kind: 'protan', answer: '8', seed: 1, dotCount: 0 }), RangeError);
  assert.throws(() => generatePlate(), RangeError);
  assert.throws(() => platePalette('unknown'), RangeError);
  assert.throws(() => isInDigit('abc', 0.5, 0.5), RangeError);
  assert.throws(() => srgbHexToXyy('nothex'), TypeError);
});

// --- the canonical plate set -----------------------------------------------------

test('buildConfusionPlateSet: 8 deterministic plates - one control, all types probed', () => {
  const set = buildConfusionPlateSet();
  assert.equal(set.length, 8);
  assert.equal(set[0].control, true);
  assert.equal(set[0].answer, '12');
  const counts = { protan: 0, deutan: 0, tritan: 0 };
  for (const plate of set.slice(1)) {
    assert.equal(plate.control, undefined, 'only the first plate is a control');
    assert.ok(CONFUSION_TYPES.includes(plate.probes), 'every non-control plate is type-tagged');
    counts[plate.probes]++;
  }
  assert.deepEqual(counts, { protan: 2, deutan: 3, tritan: 2 });
  const answers = set.map((p) => p.answer);
  assert.equal(new Set(answers).size, answers.length, 'answers are unique');
  assert.ok(answers.every((a) => /^[0-9]{1,2}$/.test(a)));
  assert.equal(JSON.stringify(set), JSON.stringify(buildConfusionPlateSet()), 'set is deterministic');
  assert.deepEqual(PLATE_KINDS, ['control', 'protan', 'deutan', 'tritan']);
});

test('plate set: contains only whitelisted plain-value keys (nothing to leak)', () => {
  for (const plate of buildConfusionPlateSet()) {
    for (const key of Object.keys(plate)) {
      assert.ok(['kind', 'answer', 'seed', 'control', 'probes', 'background', 'dots'].includes(key),
        `unexpected plate key: ${key}`);
    }
    assert.match(plate.background, /^#[0-9a-f]{6}$/);
  }
});

// --- the set activates the scoring core ------------------------------------------

test('plate set + scoring: an all-correct run tallies typical with no tendency', () => {
  const set = buildConfusionPlateSet();
  const responses = set.map((p) => p.answer);
  const tally = tallyColorTest(set, responses);
  assert.equal(tally.band, 'typical');
  assert.equal(tally.controlFailed, false);
  const tendency = classifyColorTendency(set, responses);
  assert.equal(tendency.tendency, 'none');
});

test('plate set + scoring: missing every deutan plate leans deutan with moderate confidence', () => {
  const set = buildConfusionPlateSet();
  const responses = set.map((p) => (p.probes === 'deutan' ? '' : p.answer));
  const tendency = classifyColorTendency(set, responses);
  assert.equal(tendency.tendency, 'deutan-leaning');
  assert.equal(tendency.confidence, 'moderate');
  assert.equal(tendency.perType.deutan.missed, 3);
  assert.equal(tendency.perType.deutan.total, 3);
  assert.match(tendency.note, /not a diagnosis/i);
});

test('plate set + scoring: a missed control stays honestly inconclusive', () => {
  const set = buildConfusionPlateSet();
  const responses = set.map((p) => (p.control ? '' : p.answer));
  assert.equal(classifyColorTendency(set, responses).tendency, 'inconclusive');
  assert.equal(tallyColorTest(set, responses).band, 'inconclusive');
});
