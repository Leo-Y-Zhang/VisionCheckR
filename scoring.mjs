// scoring.mjs
// VisionCheckR — pure, dependency-free scoring logic for a self-administered
// vision self-check. Every function here is deterministic and side-effect free
// so it can be unit-tested with the Node built-in test runner (node --test).
//
// IMPORTANT: This module produces EDUCATIONAL, NON-DIAGNOSTIC feedback only.
// It is not a medical device and not a substitute for a professional eye exam.

export const DISCLAIMER =
  'This is not a medical device and not a substitute for a professional eye ' +
  'exam. Results are an educational screening only and can be affected by your ' +
  'screen, lighting, calibration and distance. See a qualified optometrist or ' +
  'ophthalmologist for any concerns about your vision.';

/** Library version, kept in lockstep with package.json. */
export const VERSION = '2.2.0';

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Round to n decimal places, returning a Number (not a string). */
export function round(value, decimals = 3) {
  if (typeof value !== 'number') {
    throw new TypeError(`round: value must be a number, got: ${value}`);
  }
  if (!Number.isFinite(value)) return value; // NaN / Infinity pass through
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function requireFiniteNumber(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got: ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Visual acuity (Snellen-style)
// ---------------------------------------------------------------------------
//
// The chart is drawn on screen at a DESIGN distance. Each line has a Minimum
// Angle of Resolution (MAR) in arc-minutes. For Snellen 20/D, MAR = D / 20.
// A person with 20/20 vision resolves detail subtending 1 arc-minute (MAR = 1).
//
// Lines run largest (index 0) to smallest (last index).

export const SNELLEN_LINES = Object.freeze([
  { snellen: '20/200', marArcmin: 10.0 },
  { snellen: '20/100', marArcmin: 5.0 },
  { snellen: '20/70', marArcmin: 3.5 },
  { snellen: '20/50', marArcmin: 2.5 },
  { snellen: '20/40', marArcmin: 2.0 },
  { snellen: '20/30', marArcmin: 1.5 },
  { snellen: '20/25', marArcmin: 1.25 },
  { snellen: '20/20', marArcmin: 1.0 },
  { snellen: '20/15', marArcmin: 0.75 },
  { snellen: '20/10', marArcmin: 0.5 },
]);

/** Default distance (metres) the on-screen chart is calibrated for. */
export const DEFAULT_DESIGN_DISTANCE_M = 3.0;

/** Standard ISO/IEC reference credit-card width in millimetres. */
export const CREDIT_CARD_WIDTH_MM = 85.6;

/**
 * Pixels-per-millimetre from a calibration object of known real width.
 * The user drags an on-screen box until it matches a real credit card.
 */
export function pixelsPerMm(cardWidthPixels, cardWidthMm = CREDIT_CARD_WIDTH_MM) {
  requireFiniteNumber('cardWidthPixels', cardWidthPixels);
  requireFiniteNumber('cardWidthMm', cardWidthMm);
  if (cardWidthPixels <= 0 || cardWidthMm <= 0) {
    throw new RangeError('calibration widths must be positive');
  }
  return cardWidthPixels / cardWidthMm;
}

/**
 * On-screen height (in pixels) for an optotype (Sloan letter) whose stroke
 * subtends `marArcmin` arc-minutes at `distanceM`. A Snellen letter is 5 strokes
 * tall, so the whole letter subtends 5 * MAR arc-minutes.
 */
export function snellenLetterHeightPx({ marArcmin, distanceM, pixelsPerMm: ppmm }) {
  requireFiniteNumber('marArcmin', marArcmin);
  requireFiniteNumber('distanceM', distanceM);
  requireFiniteNumber('pixelsPerMm', ppmm);
  if (marArcmin <= 0 || distanceM <= 0 || ppmm <= 0) {
    throw new RangeError('marArcmin, distanceM and pixelsPerMm must be positive');
  }
  const letterArcmin = 5 * marArcmin;
  const radians = (letterArcmin * Math.PI) / (180 * 60);
  const heightMm = distanceM * 1000 * Math.tan(radians);
  return heightMm * ppmm;
}

function acuityBand(logMAR) {
  if (logMAR <= 0.0) return 'typical';         // 20/20 or better
  if (logMAR <= 0.35) return 'mildly-reduced'; // through 20/40 (logMAR .301)
  if (logMAR <= 0.6) return 'moderately-reduced'; // 20/50 (.398) .. 20/70 (.544)
  return 'notably-reduced';                    // 20/100 (.699) and worse
}

// Shared MAR math for distance and near acuity. The physical letter is fixed;
// viewing from a different distance rescales the angle it subtends, hence the
// effective MAR. (Extracted so distance + near acuity share one implementation;
// acuityScore's output is unchanged.)
function acuityMetrics(marArcmin, actualDistanceM, designDistanceM) {
  const scale = designDistanceM / actualDistanceM;
  const effectiveMAR = marArcmin * scale;
  const logMAR = Math.log10(effectiveMAR);
  // Guard against a degenerate "20/0" when a very large viewing distance shrinks
  // the effective MAR so far that 20 * effectiveMAR rounds down to zero.
  const snellenDenominator = Math.max(1, Math.round(20 * effectiveMAR));
  return { effectiveMAR, logMAR, snellenDenominator };
}

/**
 * Score visual acuity from the smallest line the user could fully read.
 *
 * @param {object} p
 * @param {number} p.lineIndex        Index into SNELLEN_LINES, or -1 if none read.
 * @param {number} p.actualDistanceM  Real viewing distance the user measured.
 * @param {number} [p.designDistanceM]Distance the chart was drawn for.
 * @returns {object} result with snellen, logMAR, band and a plain-language note.
 */
export function acuityScore({
  lineIndex,
  actualDistanceM,
  designDistanceM = DEFAULT_DESIGN_DISTANCE_M,
}) {
  requireFiniteNumber('lineIndex', lineIndex);
  requireFiniteNumber('actualDistanceM', actualDistanceM);
  requireFiniteNumber('designDistanceM', designDistanceM);
  if (!Number.isInteger(lineIndex)) {
    throw new RangeError(`lineIndex must be an integer, got: ${lineIndex}`);
  }
  if (actualDistanceM <= 0 || designDistanceM <= 0) {
    throw new RangeError('distances must be positive');
  }

  if (lineIndex < 0) {
    return {
      lineIndex: -1,
      readable: false,
      band: 'inconclusive',
      note:
        'No line was read clearly. This can happen with poor calibration or ' +
        'lighting. Retry, and if letters still cannot be read, see an eye-care ' +
        'professional.',
    };
  }
  if (lineIndex >= SNELLEN_LINES.length) {
    throw new RangeError(`lineIndex ${lineIndex} out of range`);
  }

  const line = SNELLEN_LINES[lineIndex];
  const { effectiveMAR, logMAR, snellenDenominator } = acuityMetrics(
    line.marArcmin,
    actualDistanceM,
    designDistanceM,
  );
  const band = acuityBand(logMAR);

  return {
    lineIndex,
    readable: true,
    designSnellen: line.snellen,
    snellen: `20/${snellenDenominator}`,
    snellenDenominator,
    effectiveMAR: round(effectiveMAR, 3),
    logMAR: round(logMAR, 3),
    band,
    note: acuityNote(band),
  };
}

function acuityNote(band) {
  switch (band) {
    case 'typical':
      return 'Your read distance vision looks typical in this quick check.';
    case 'mildly-reduced':
      return 'This suggests mildly reduced distance vision. Consider an eye test.';
    case 'moderately-reduced':
      return 'This suggests moderately reduced distance vision. An eye test is advised.';
    default:
      return 'This suggests notably reduced distance vision. Please see an eye-care professional.';
  }
}

// ---------------------------------------------------------------------------
// Near (reading) acuity
// ---------------------------------------------------------------------------

/** Default reading (near) distance in metres (~40 cm). */
export const NEAR_DEFAULT_DESIGN_DISTANCE_M = 0.4;

/** APPROXIMATE N-notation from logMAR (educational label only, not clinical). */
function nearNApprox(logMAR) {
  return `N${Math.max(4, Math.round(5 * 10 ** logMAR))}`;
}

function nearAcuityNote(band) {
  switch (band) {
    case 'typical':
      return 'Your near (reading) vision looks typical in this quick check. This is a screening only, not a glasses prescription.';
    case 'mildly-reduced':
      return 'This suggests mildly reduced near (reading) vision. Consider an eye test; this is a screening, not a glasses prescription.';
    case 'moderately-reduced':
      return 'This suggests moderately reduced near (reading) vision. An eye test is advised; this is not a glasses prescription.';
    default:
      return 'This suggests notably reduced near (reading) vision. Please see an eye-care professional. This is not a glasses prescription.';
  }
}

/**
 * Score NEAR (reading) acuity from the smallest line read at a near distance
 * (~40 cm). Reuses the distance-acuity MAR math at a near design distance and
 * adds an APPROXIMATE N-notation label. Screening only — never a glasses
 * prescription. Mirrors acuityScore's shape and fail-loud validation.
 *
 * @param {object} p
 * @param {number} p.lineIndex        Index into SNELLEN_LINES, or -1 if none read.
 * @param {number} p.actualDistanceM  Real reading distance the user measured.
 * @param {number} [p.designDistanceM] Distance the near chart was drawn for.
 */
export function nearAcuityScore({
  lineIndex,
  actualDistanceM,
  designDistanceM = NEAR_DEFAULT_DESIGN_DISTANCE_M,
}) {
  requireFiniteNumber('lineIndex', lineIndex);
  requireFiniteNumber('actualDistanceM', actualDistanceM);
  requireFiniteNumber('designDistanceM', designDistanceM);
  if (!Number.isInteger(lineIndex)) {
    throw new RangeError(`lineIndex must be an integer, got: ${lineIndex}`);
  }
  if (actualDistanceM <= 0 || designDistanceM <= 0) {
    throw new RangeError('distances must be positive');
  }

  if (lineIndex < 0) {
    return {
      lineIndex: -1,
      readable: false,
      band: 'inconclusive',
      note:
        'No near line was read clearly. Retry under good reading light at a steady ' +
        '~40 cm; if text still cannot be read, see an eye-care professional.',
    };
  }
  if (lineIndex >= SNELLEN_LINES.length) {
    throw new RangeError(`lineIndex ${lineIndex} out of range`);
  }

  const line = SNELLEN_LINES[lineIndex];
  const { effectiveMAR, logMAR, snellenDenominator } = acuityMetrics(
    line.marArcmin,
    actualDistanceM,
    designDistanceM,
  );
  const band = acuityBand(logMAR);

  return {
    lineIndex,
    readable: true,
    designSnellen: line.snellen,
    snellenNearEquivalent: `20/${snellenDenominator}`,
    nApprox: nearNApprox(logMAR),
    effectiveMAR: round(effectiveMAR, 3),
    logMAR: round(logMAR, 3),
    band,
    note: nearAcuityNote(band),
  };
}

// ---------------------------------------------------------------------------
// Colour vision (Ishihara-style plates)
// ---------------------------------------------------------------------------

function normaliseAnswer(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'nothing' || s === 'no' || s === '-') {
    return '';
  }
  return s;
}

/**
 * Tally an Ishihara-style colour plate test.
 *
 * @param {Array<{answer:string, control?:boolean}>} plates Expected answers.
 * @param {Array<string>} responses What the user reported per plate.
 * @returns {object} totals, ratio, band, and reliability info.
 */
export function tallyColorTest(plates, responses) {
  if (!Array.isArray(plates) || !Array.isArray(responses)) {
    throw new TypeError('plates and responses must both be arrays');
  }
  if (plates.length === 0) {
    throw new RangeError('plates must not be empty');
  }

  let correct = 0;
  let controlTotal = 0;
  let controlCorrect = 0;
  const perPlate = [];

  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i];
    if (plate === null || typeof plate !== 'object') {
      throw new TypeError(`plate ${i} must be an object`);
    }
    const expected = normaliseAnswer(plate.answer);
    const given = normaliseAnswer(responses[i]);
    const isCorrect = expected !== '' && given === expected;
    if (isCorrect) correct++;
    if (plate.control) {
      controlTotal++;
      if (isCorrect) controlCorrect++;
    }
    perPlate.push({ index: i, expected, given, correct: isCorrect });
  }

  const total = plates.length;
  const correctRatio = round(correct / total, 3);
  const controlFailed = controlTotal > 0 && controlCorrect < controlTotal;

  let band;
  if (controlFailed) band = 'inconclusive';
  else if (correctRatio >= 0.85) band = 'typical';
  else if (correctRatio >= 0.4) band = 'possible-deficiency';
  else band = 'significant-difference';

  return {
    total,
    correct,
    incorrect: total - correct,
    correctRatio,
    controlTotal,
    controlCorrect,
    controlFailed,
    flaggedForReview: band !== 'typical',
    band,
    note: colorNote(band),
    perPlate,
  };
}

function colorNote(band) {
  switch (band) {
    case 'typical':
      return 'You identified the plates as expected — no colour-vision concern flagged.';
    case 'possible-deficiency':
      return 'Several plates were read differently than expected, which can indicate a colour-vision difference. Consider a professional colour-vision test.';
    case 'significant-difference':
      return 'Many plates were read differently than expected. A professional colour-vision assessment is advised.';
    default:
      return 'A control plate everyone should read was missed, so this run is inconclusive. Check your screen and lighting and retry.';
  }
}

const COLOR_TYPES = Object.freeze(['protan', 'deutan', 'tritan']);

/**
 * Infer an EDUCATIONAL colour-vision TENDENCY from the pattern of misses across
 * plates tagged with the deficiency type they probe (`probes`). This is NEVER a
 * diagnosis and never a definitive type — only a leaning that a professional
 * colour-vision test can confirm and classify. Control-plate failure or an
 * absence of tagged plates returns `inconclusive` (never a guess).
 *
 * @param {Array<{answer:string, probes?:string, control?:boolean}>} plates
 * @param {Array<string>} responses
 */
export function classifyColorTendency(plates, responses) {
  if (!Array.isArray(plates) || !Array.isArray(responses)) {
    throw new TypeError('plates and responses must both be arrays');
  }
  if (plates.length === 0) {
    throw new RangeError('plates must not be empty');
  }

  const perType = {
    protan: { total: 0, missed: 0 },
    deutan: { total: 0, missed: 0 },
    tritan: { total: 0, missed: 0 },
  };
  let controlTotal = 0;
  let controlCorrect = 0;

  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i];
    if (plate === null || typeof plate !== 'object') {
      throw new TypeError(`plate ${i} must be an object`);
    }
    const expected = normaliseAnswer(plate.answer);
    const given = normaliseAnswer(responses[i]);
    const isCorrect = expected !== '' && given === expected;
    if (plate.control) {
      controlTotal++;
      if (isCorrect) controlCorrect++;
    }
    if (COLOR_TYPES.includes(plate.probes)) {
      perType[plate.probes].total++;
      if (!isCorrect) perType[plate.probes].missed++;
    }
  }

  const controlFailed = controlTotal > 0 && controlCorrect < controlTotal;
  const tagged = COLOR_TYPES.filter((t) => perType[t].total > 0);

  if (controlFailed) {
    return {
      tendency: 'inconclusive',
      perType,
      confidence: 'low',
      note:
        'A control plate everyone should read was missed, so no colour-vision ' +
        'tendency can be inferred. Check your screen and lighting and retry; a ' +
        'professional colour-vision test can classify colour vision.',
    };
  }
  if (tagged.length === 0) {
    return {
      tendency: 'inconclusive',
      perType,
      confidence: 'low',
      note:
        'No type-tagged plates were provided, so no colour-vision tendency can be ' +
        'inferred. A professional colour-vision test is needed to classify.',
    };
  }

  // A type "leans" if at least half of its plates were missed (and >= 1 miss).
  const leaning = tagged.filter(
    (t) => perType[t].missed >= 1 && perType[t].missed / perType[t].total >= 0.5,
  );

  let tendency;
  let confidence;
  if (leaning.length === 0) {
    tendency = 'none';
    confidence = 'low';
  } else if (leaning.length === 1) {
    tendency = `${leaning[0]}-leaning`;
    confidence = perType[leaning[0]].missed >= 2 ? 'moderate' : 'low';
  } else {
    tendency = 'mixed';
    confidence = 'low';
  }

  return { tendency, perType, confidence, note: colorTendencyNote(tendency) };
}

function colorTendencyNote(tendency) {
  if (tendency === 'none') {
    return (
      'Your responses did not show a consistent colour-vision tendency in this ' +
      'quick check. This is an educational screening only, not a diagnosis; a ' +
      'professional colour-vision test can classify colour vision.'
    );
  }
  if (tendency === 'mixed') {
    return (
      'Your responses missed plates across more than one colour-vision type, which ' +
      'does not point to a single type. This is not a diagnosis; a professional ' +
      'colour-vision test is needed to classify.'
    );
  }
  const type = tendency.replace('-leaning', '');
  return (
    `Your responses leaned toward a ${type}-type colour-vision difference in this ` +
    'educational check. This is NOT a diagnosis and not a definitive type — a ' +
    'professional colour-vision test is needed to confirm and classify.'
  );
}

// ---------------------------------------------------------------------------
// Astigmatism fan / dial
// ---------------------------------------------------------------------------

/**
 * Interpret an astigmatism fan/dial response.
 *
 * @param {Array<number>} reportedDarkerAxes Axis angles (0..180 deg) the user
 *   felt looked darker/sharper than the rest. Empty = all uniform.
 * @returns {object} indicatesAstigmatism, cleaned axes, and a note.
 */
export function astigmatismResult(reportedDarkerAxes) {
  if (!Array.isArray(reportedDarkerAxes)) {
    throw new TypeError('reportedDarkerAxes must be an array');
  }
  const cleaned = [];
  for (const a of reportedDarkerAxes) {
    requireFiniteNumber('axis', a);
    if (a < 0 || a > 180) {
      throw new RangeError(`axis ${a} must be within 0..180 degrees`);
    }
    if (!cleaned.includes(a)) cleaned.push(a);
  }
  cleaned.sort((x, y) => x - y);

  const indicates = cleaned.length > 0;
  return {
    indicatesAstigmatism: indicates,
    axes: cleaned,
    band: indicates ? 'possible-astigmatism' : 'typical',
    note: indicates
      ? `Some directions (around ${cleaned.join(', ')} degrees) looked darker or sharper. ` +
        'Uneven line contrast can be a sign of astigmatism. An eye test can confirm.'
      : 'All directions looked about equal — no astigmatism indication in this quick check.',
  };
}

// ---------------------------------------------------------------------------
// Contrast sensitivity
// ---------------------------------------------------------------------------

/**
 * Estimate a contrast threshold from a descending staircase.
 *
 * @param {Array<{contrast:number, correct:boolean}>} items Stimuli ordered from
 *   highest contrast to lowest. `contrast` is a fraction in (0, 1].
 * @returns {object} thresholdContrast, logCS, band and a note.
 */
export function contrastThreshold(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('items must be a non-empty array');
  }

  let threshold = null;
  // Threshold = lowest contrast in the leading run of correct answers.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === null || typeof item !== 'object') {
      throw new TypeError(`item ${i} must be an object`);
    }
    requireFiniteNumber('contrast', item.contrast);
    if (item.contrast <= 0 || item.contrast > 1) {
      throw new RangeError(`contrast ${item.contrast} must be in (0, 1]`);
    }
    if (item.correct === true) {
      threshold = item.contrast;
    } else {
      break; // first miss ends the reliable run
    }
  }

  if (threshold === null) {
    return {
      thresholdContrast: null,
      logCS: null,
      band: 'inconclusive',
      note:
        'Even the highest-contrast target was missed, so this run is ' +
        'inconclusive. Check your screen brightness and lighting, then retry.',
    };
  }

  const logCS = round(Math.log10(1 / threshold), 3);
  let band;
  if (logCS >= 1.8) band = 'typical';
  else if (logCS >= 1.5) band = 'borderline';
  else band = 'reduced';

  return {
    thresholdContrast: round(threshold, 4),
    thresholdPercent: round(threshold * 100, 2),
    logCS,
    band,
    note: contrastNote(band),
  };
}

function contrastNote(band) {
  switch (band) {
    case 'typical':
      return 'Your contrast sensitivity looks typical in this quick check.';
    case 'borderline':
      return 'Your contrast sensitivity looks slightly reduced. Consider an eye test.';
    default:
      return 'Your contrast sensitivity looks reduced in this check. An eye test is advised.';
  }
}

// ---------------------------------------------------------------------------
// Adaptive staircase threshold (deterministic reversal averaging)
// ---------------------------------------------------------------------------

// Reversal LEVELS in a presented staircase: the turning points where the level
// direction flips. Flat steps (no movement) are ignored.
function reversalLevels(levels) {
  const reversals = [];
  let prevDir = 0;
  for (let i = 1; i < levels.length; i++) {
    const d = levels[i] - levels[i - 1];
    if (d === 0) continue;
    const dir = d > 0 ? 1 : -1;
    if (prevDir !== 0 && dir !== prevDir) {
      reversals.push(levels[i - 1]);
    }
    prevDir = dir;
  }
  return reversals;
}

/**
 * Estimate a threshold from a COMPLETED transformed-staircase run as the mean of
 * the last N reversal levels. Deterministic: it consumes the given trial sequence
 * (no randomness). Generic over `level` (works for contrast or acuity MAR).
 * Lapse-tolerant: averaging reversals dilutes a stray response, and only the last
 * N reversals count so early anomalies drop out. Fewer than `minReversals`
 * reversals -> inconclusive (never a guess).
 *
 * @param {Array<{level:number, correct:boolean}>} trials In presentation order.
 * @param {object} [opts]
 * @param {number} [opts.lastNReversals=6]
 * @param {number} [opts.minReversals=2]
 */
export function staircaseThreshold(trials, opts = {}) {
  opts = opts ?? {};
  const lastNReversals = opts.lastNReversals ?? 6;
  const minReversals = opts.minReversals ?? 2;
  if (!Array.isArray(trials)) {
    throw new TypeError('trials must be an array');
  }
  if (trials.length === 0) {
    throw new RangeError('trials must not be empty');
  }
  if (!Number.isInteger(lastNReversals) || lastNReversals < 1) {
    throw new RangeError('lastNReversals must be a positive integer');
  }
  if (!Number.isInteger(minReversals) || minReversals < 1) {
    throw new RangeError('minReversals must be a positive integer');
  }

  const levels = [];
  let lapses = 0;
  for (let i = 0; i < trials.length; i++) {
    const t = trials[i];
    if (t === null || typeof t !== 'object') {
      throw new TypeError(`trial ${i} must be an object {level, correct}`);
    }
    requireFiniteNumber(`trial ${i} level`, t.level);
    if (typeof t.correct !== 'boolean') {
      throw new TypeError(`trial ${i}.correct must be a boolean`);
    }
    levels.push(t.level);
    if (!t.correct) lapses++;
  }

  const reversals = reversalLevels(levels);
  if (reversals.length < minReversals) {
    return {
      inconclusive: true,
      threshold: null,
      reversals,
      usableReversals: reversals.length,
      nReversalsUsed: 0,
      lapses,
      note:
        `The staircase produced too few reversals (${reversals.length}; need at ` +
        `least ${minReversals}) to estimate a threshold. This is a screening only; ` +
        'retry, and see an eye-care professional for any concern.',
    };
  }

  const used = reversals.slice(-lastNReversals);
  const threshold = round(used.reduce((a, b) => a + b, 0) / used.length, 4);
  return {
    inconclusive: false,
    threshold,
    reversals,
    usableReversals: reversals.length,
    nReversalsUsed: used.length,
    lapses,
    note:
      `Estimated from the mean of the last ${used.length} staircase reversal(s). ` +
      'This is an educational screening estimate, not a clinical measurement; see ' +
      'an eye-care professional for any concern.',
  };
}

// ---------------------------------------------------------------------------
// Per-eye labelling and interocular asymmetry
// ---------------------------------------------------------------------------

/** The eye a result belongs to. */
export const EYES = Object.freeze(['left', 'right', 'both']);

/**
 * Tag a module result with the eye it came from, WITHOUT mutating the source.
 * @param {object} result A per-module scoring result.
 * @param {'left'|'right'|'both'} eye
 */
export function labelEye(result, eye) {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('labelEye: result must be an object');
  }
  if (!EYES.includes(eye)) {
    throw new RangeError(`labelEye: eye must be one of ${EYES.join(', ')}, got: ${eye}`);
  }
  return { ...result, eye };
}

// Per-module interocular-difference thresholds. These are EDUCATIONAL screening
// thresholds, not clinical cut-offs: ~0.2 logMAR is about two acuity lines, and
// ~0.3 logCS is a commonly-cited "worth a look" contrast difference.
const EYE_ASYMMETRY = Object.freeze({
  acuity: { field: 'logMAR', threshold: 0.2, unit: 'logMAR' },
  contrast: { field: 'logCS', threshold: 0.3, unit: 'logCS' },
});

/**
 * Compare the same module's result between the two eyes and flag a NOTABLE
 * interocular difference. EDUCATIONAL only — a difference is worth mentioning to
 * a professional, never a diagnosis. Returns `comparable:false` (never a guess)
 * when either eye lacks a finite metric.
 *
 * @param {'acuity'|'contrast'} moduleKey
 * @param {object} left  A result for the left eye.
 * @param {object} right A result for the right eye.
 */
export function compareEyes(moduleKey, left, right) {
  const spec = EYE_ASYMMETRY[moduleKey];
  if (!spec) {
    throw new RangeError(
      `compareEyes: unsupported module '${moduleKey}' ` +
        `(use one of: ${Object.keys(EYE_ASYMMETRY).join(', ')})`,
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    throw new TypeError('compareEyes: left and right must both be result objects');
  }

  const lv = left[spec.field];
  const rv = right[spec.field];
  if (
    typeof lv !== 'number' ||
    !Number.isFinite(lv) ||
    typeof rv !== 'number' ||
    !Number.isFinite(rv)
  ) {
    return {
      module: moduleKey,
      comparable: false,
      asymmetric: false,
      band: 'inconclusive',
      note:
        'One or both eyes did not produce a comparable result, so no between-eye ' +
        'comparison was made. Retry both eyes under the same conditions.',
    };
  }

  const delta = round(Math.abs(lv - rv), 3);
  const asymmetric = delta >= spec.threshold;
  return {
    module: moduleKey,
    comparable: true,
    delta,
    unit: spec.unit,
    threshold: spec.threshold,
    asymmetric,
    band: asymmetric ? 'notable-asymmetry' : 'symmetric',
    note: asymmetric
      ? `Your two eyes differed by about ${delta} ${spec.unit} on this check. A ` +
        'clear between-eye difference is worth mentioning to an eye-care ' +
        'professional. This is a difference, not a diagnosis.'
      : `Your two eyes were similar on this check (about ${delta} ${spec.unit} apart).`,
  };
}

// ---------------------------------------------------------------------------
// Overall summary
// ---------------------------------------------------------------------------

/**
 * Combine per-module results into plain-language, NON-DIAGNOSTIC feedback.
 *
 * @param {object} results { acuity?, color?, astigmatism?, contrast? }
 * @returns {object} { anyFlags, headline, lines[], recommendation, disclaimer }
 */
export function summarize(results = {}) {
  const lines = [];
  const flags = [];

  if (results.acuity) {
    lines.push({ module: 'Visual acuity', text: results.acuity.note });
    if (results.acuity.band && !['typical'].includes(results.acuity.band)) {
      flags.push('acuity');
    }
  }
  if (results.color) {
    lines.push({ module: 'Colour vision', text: results.color.note });
    if (results.color.flaggedForReview) flags.push('color');
  }
  if (results.astigmatism) {
    lines.push({ module: 'Astigmatism', text: results.astigmatism.note });
    if (results.astigmatism.indicatesAstigmatism) flags.push('astigmatism');
  }
  if (results.contrast) {
    lines.push({ module: 'Contrast sensitivity', text: results.contrast.note });
    if (results.contrast.band && !['typical'].includes(results.contrast.band)) {
      flags.push('contrast');
    }
  }

  // Optional interocular comparisons (from compareEyes). Additive: v1 callers
  // omit `eyeComparisons` and are unchanged. Only comparable results contribute.
  if (Array.isArray(results.eyeComparisons)) {
    for (const cmp of results.eyeComparisons) {
      if (cmp && typeof cmp === 'object' && cmp.comparable) {
        lines.push({ module: `Between-eye (${cmp.module})`, text: cmp.note });
        if (cmp.asymmetric) flags.push(`asymmetry:${cmp.module}`);
      }
    }
  }

  // Optional colour-vision tendency (from classifyColorTendency). Additive.
  if (results.colorTendency && typeof results.colorTendency === 'object') {
    const ct = results.colorTendency;
    if (ct.note) lines.push({ module: 'Colour-vision tendency', text: ct.note });
    if (ct.tendency && !['none', 'inconclusive'].includes(ct.tendency)) {
      flags.push(`colorTendency:${ct.tendency}`);
    }
  }

  // Optional near (reading) vision (from nearAcuityScore). Additive.
  if (results.nearAcuity) {
    lines.push({ module: 'Near vision', text: results.nearAcuity.note });
    if (results.nearAcuity.band && !['typical'].includes(results.nearAcuity.band)) {
      flags.push('nearAcuity');
    }
  }

  // Optional whole-run reliability (from assessReliability). Additive.
  if (results.reliability && typeof results.reliability === 'object') {
    const rel = results.reliability;
    if (rel.note) lines.push({ module: 'Reliability', text: rel.note });
    if (rel.band && rel.band !== 'reliable') flags.push(`reliability:${rel.band}`);
  }

  const anyFlags = flags.length > 0;
  const headline = anyFlags
    ? 'One or more checks flagged something worth following up.'
    : 'Nothing was flagged in these quick checks.';
  const recommendation = anyFlags
    ? 'Because at least one check was flagged, book an appointment with a qualified ' +
      'optometrist or ophthalmologist for a proper examination.'
    : 'Even with nothing flagged, routine professional eye exams are recommended. ' +
      'This tool cannot detect many eye conditions.';

  return {
    anyFlags,
    flags,
    headline,
    lines,
    recommendation,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Whole-run reliability / quality assessment
// ---------------------------------------------------------------------------

/**
 * Judge whether a whole session is trustworthy enough to read. An unreliable run
 * is INCONCLUSIVE, never dressed up as a result. All checks are additive — only
 * what the session provides is assessed. Bands: `reliable` (all usable),
 * `partial` (some usable, some inconclusive), `unreliable` (bad calibration, a
 * colour control failure with no other usable data, or no usable modules).
 *
 * @param {object} session { pixelsPerMm?, viewingDistanceM?, acuity?, nearAcuity?,
 *   color?, colorTendency?, contrast?, astigmatism? }
 */
export function assessReliability(session) {
  if (session === null || typeof session !== 'object' || Array.isArray(session)) {
    throw new TypeError('session must be an object');
  }

  const issues = [];
  let calibrationBad = false;

  if (session.pixelsPerMm !== undefined) {
    const v = session.pixelsPerMm;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 30) {
      issues.push({
        module: 'calibration',
        reason: 'Screen calibration (pixels per mm) looks implausible; recalibrate with a real card.',
      });
      calibrationBad = true;
    }
  }
  if (session.viewingDistanceM !== undefined) {
    const v = session.viewingDistanceM;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.2 || v > 6) {
      issues.push({
        module: 'calibration',
        reason: 'Viewing distance looks implausible; measure it again.',
      });
      calibrationBad = true;
    }
  }

  let present = 0;
  let usable = 0;

  if (session.color || session.colorTendency) {
    present++;
    const controlFailed =
      (session.color && session.color.controlFailed === true) ||
      (session.colorTendency && session.colorTendency.tendency === 'inconclusive');
    if (controlFailed) {
      issues.push({
        module: 'color',
        reason: 'A colour control plate was missed (or the result was inconclusive); the colour run is unreliable.',
      });
    } else {
      usable++;
    }
  }

  for (const [name, res] of [
    ['acuity', session.acuity],
    ['nearAcuity', session.nearAcuity],
    ['contrast', session.contrast],
    ['astigmatism', session.astigmatism],
  ]) {
    if (!res || typeof res !== 'object') continue;
    present++;
    if (res.band === 'inconclusive' || res.inconclusive === true) {
      issues.push({ module: name, reason: `The ${name} check was inconclusive; retry under better conditions.` });
    } else {
      usable++;
    }
  }

  let band;
  if (present === 0) {
    band = 'unreliable';
    issues.push({ module: 'session', reason: 'No completed modules to assess.' });
  } else if (calibrationBad || usable === 0) {
    band = 'unreliable';
  } else if (usable < present) {
    band = 'partial';
  } else {
    band = 'reliable';
  }

  return { reliable: band === 'reliable', band, issues, present, usable, note: reliabilityNote(band) };
}

function reliabilityNote(band) {
  switch (band) {
    case 'reliable':
      return 'This run looks internally consistent for a quick screening. It is still an educational screening, not a diagnosis; see an eye-care professional for any concern.';
    case 'partial':
      return 'Some checks were inconclusive, so treat this run as partial. Retry the flagged checks under better conditions; this is a screening only, not a diagnosis.';
    default:
      return 'This run is unreliable (calibration, a control check, or too many inconclusive results). Retry under better lighting and calibration; this is a screening only — see an eye-care professional for any concern.';
  }
}

// ---------------------------------------------------------------------------
// Deterministic session report
// ---------------------------------------------------------------------------

/** Bumped when the report shape changes in a breaking way. */
export const REPORT_SCHEMA_VERSION = '1.0';

/**
 * Assemble a portable, DETERMINISTIC report from a session (the same shape
 * summarize() accepts). `opts.generatedAt` is INJECTED (default null); the wall
 * clock is never read, so identical inputs render byte-identically.
 *
 * @param {object} session
 * @param {object} [opts]
 * @param {string|null} [opts.generatedAt]
 */
export function buildReport(session, opts = {}) {
  if (session === null || typeof session !== 'object' || Array.isArray(session)) {
    throw new TypeError('session must be an object');
  }
  opts = opts ?? {};
  const generatedAt = opts.generatedAt ?? null;
  if (generatedAt !== null && typeof generatedAt !== 'string') {
    throw new TypeError('opts.generatedAt must be a string or null');
  }
  const summary = summarize(session);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    disclaimer: DISCLAIMER,
    anyFlags: summary.anyFlags,
    flags: summary.flags,
    headline: summary.headline,
    recommendation: summary.recommendation,
    lines: summary.lines,
  };
}

// Deterministic JSON: object keys sorted recursively so identical inputs give
// byte-identical output regardless of insertion order.
function stableStringify(value) {
  return JSON.stringify(
    value,
    (key, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
        : val,
    2,
  );
}

/** Deterministic JSON rendering of a report (embeds the DISCLAIMER). */
export function reportToJson(report) {
  return stableStringify(report);
}

/** Plain-text human-readable rendering of a report (embeds the DISCLAIMER). */
export function reportToText(report) {
  const out = [
    'VisionCheckR vision self-check report',
    '================================',
    `Schema: ${report.schemaVersion}`,
    `Generated at: ${report.generatedAt ?? 'unset'}`,
    '',
    report.headline,
    '',
  ];
  for (const line of report.lines) {
    out.push(`- ${line.module}: ${line.text}`);
  }
  out.push('', `Recommendation: ${report.recommendation}`, '', report.disclaimer);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Local save / compare (PII-free serialization)
// ---------------------------------------------------------------------------

/** Bumped when the serialized shape changes in a breaking way. */
export const PERSIST_SCHEMA_VERSION = '1.0';

// Whitelist of primitive fields serialized per module. This is what makes the
// stored payload PII-free BY CONSTRUCTION: only bands/scores are ever copied.
const SERIALIZABLE_FIELDS = Object.freeze({
  acuity: ['band', 'logMAR', 'snellen'],
  nearAcuity: ['band', 'logMAR', 'nApprox'],
  color: ['band', 'correctRatio'],
  colorTendency: ['tendency', 'confidence'],
  astigmatism: ['band', 'indicatesAstigmatism'],
  contrast: ['band', 'thresholdContrast', 'logCS', 'threshold'],
  reliability: ['band'],
});

/**
 * Serialize a session into a compact, PII-FREE payload safe for LOCAL storage
 * (the app keeps it in localStorage; it is never uploaded). Only whitelisted
 * primitive band/score fields and numeric calibration are copied — no identity
 * data can leak. `opts.label` / `opts.savedAt` are OPTIONAL injected strings.
 */
export function serializeSession(session, opts = {}) {
  if (session === null || typeof session !== 'object' || Array.isArray(session)) {
    throw new TypeError('session must be an object');
  }
  opts = opts ?? {};
  const label = opts.label ?? null;
  const savedAt = opts.savedAt ?? null;
  if (label !== null && typeof label !== 'string') {
    throw new TypeError('opts.label must be a string or null');
  }
  if (savedAt !== null && typeof savedAt !== 'string') {
    throw new TypeError('opts.savedAt must be a string or null');
  }

  const modules = {};
  for (const [name, fields] of Object.entries(SERIALIZABLE_FIELDS)) {
    const res = session[name];
    if (!res || typeof res !== 'object') continue;
    const picked = {};
    for (const f of fields) {
      const v = res[f];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        picked[f] = v;
      }
    }
    if (Object.keys(picked).length > 0) modules[name] = picked;
  }

  const calibration = {};
  for (const f of ['pixelsPerMm', 'viewingDistanceM']) {
    if (typeof session[f] === 'number' && Number.isFinite(session[f])) {
      calibration[f] = session[f];
    }
  }

  return { schemaVersion: PERSIST_SCHEMA_VERSION, label, savedAt, modules, calibration };
}

/**
 * Validate + normalise a serialized payload back into a session snapshot. Fails
 * loud on a wrong/absent schema or a malformed shape (never guesses).
 */
export function deserializeSession(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new TypeError('serialized session must be an object');
  }
  if (obj.schemaVersion !== PERSIST_SCHEMA_VERSION) {
    throw new RangeError(
      `unsupported schemaVersion: ${obj.schemaVersion} (expected ${PERSIST_SCHEMA_VERSION})`,
    );
  }
  if (obj.modules === null || typeof obj.modules !== 'object' || Array.isArray(obj.modules)) {
    throw new TypeError('serialized session .modules must be an object');
  }
  const calibration =
    obj.calibration && typeof obj.calibration === 'object' && !Array.isArray(obj.calibration)
      ? obj.calibration
      : {};
  return {
    schemaVersion: obj.schemaVersion,
    label: obj.label ?? null,
    savedAt: obj.savedAt ?? null,
    modules: obj.modules,
    calibration,
  };
}

// Per-module band ordering (best -> worst) for trend direction. Modules whose
// bands are not ordinal (colour type, astigmatism) are not trended here.
const BAND_ORDER = Object.freeze({
  acuity: ['typical', 'mildly-reduced', 'moderately-reduced', 'notably-reduced'],
  nearAcuity: ['typical', 'mildly-reduced', 'moderately-reduced', 'notably-reduced'],
  contrast: ['typical', 'borderline', 'reduced'],
});

/**
 * Compare two serialized sessions for an EDUCATIONAL trend. Reports better /
 * worse / same per ordinal module (acuity, near, contrast). A trend is not a
 * diagnosis — screen, lighting and calibration all affect it.
 */
export function compareSessions(prev, curr) {
  for (const [name, s] of [['prev', prev], ['curr', curr]]) {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      throw new TypeError(`${name} must be a serialized session object`);
    }
  }
  const pm = prev.modules && typeof prev.modules === 'object' ? prev.modules : {};
  const cm = curr.modules && typeof curr.modules === 'object' ? curr.modules : {};

  const changes = [];
  for (const [name, order] of Object.entries(BAND_ORDER)) {
    const from = pm[name] && pm[name].band;
    const to = cm[name] && cm[name].band;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    const fi = order.indexOf(from);
    const ti = order.indexOf(to);
    if (fi < 0 || ti < 0) continue; // e.g. 'inconclusive' -> not comparable
    changes.push({
      module: name,
      from,
      to,
      direction: ti < fi ? 'better' : ti > fi ? 'worse' : 'same',
    });
  }

  return {
    changes,
    note:
      'This compares two educational screening runs to show a trend only. Trends ' +
      'can be affected by your screen, lighting and calibration; this is not a ' +
      'diagnosis. See an eye-care professional for any concern.',
  };
}
