// app.js — VisionCheckR UI controller.
// Wires the interactive DOM/canvas modules to the tested pure scoring core.
// Everything runs locally in the browser; no network calls, no storage upload.

import {
  DISCLAIMER,
  DEFAULT_DESIGN_DISTANCE_M,
  CREDIT_CARD_WIDTH_MM,
  SNELLEN_LINES,
  pixelsPerMm,
  snellenLetterHeightPx,
  acuityScore,
  tallyColorTest,
  classifyColorTendency,
  astigmatismResult,
  contrastThreshold,
  summarize,
  assessReliability,
  buildReport,
  reportToJson,
  reportToText,
  serializeSession,
  deserializeSession,
  compareSessions,
} from './scoring.mjs';
import { buildConfusionPlateSet, gammaDecode } from './plates.mjs';

// ---------------------------------------------------------------------------
// Tiny DOM helper
// ---------------------------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v; // no innerHTML sink: text only
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------------------------------------------------------------------------
// App state (in-memory only)
// ---------------------------------------------------------------------------
const STEPS = ['intro', 'calibrate', 'color', 'acuity', 'astigmatism', 'contrast', 'summary'];

const state = {
  step: 'intro',
  calibration: {
    cardWidthPx: 320,           // adjusted by the user
    distanceM: DEFAULT_DESIGN_DISTANCE_M,
  },
  results: {},                  // filled per module
};

const appRoot = document.getElementById('app');
const stepper = document.getElementById('stepper');

function ppmm() {
  return pixelsPerMm(state.calibration.cardWidthPx, CREDIT_CARD_WIDTH_MM);
}

// The session object the pure core functions consume: every module result plus
// the numeric calibration values. Judgement stays in the core; this only shapes.
function coreSession() {
  return {
    ...state.results,
    pixelsPerMm: ppmm(),
    viewingDistanceM: state.calibration.distanceM,
  };
}

function goto(step) {
  state.step = step;
  state.justSaved = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Local save / compare (localStorage; PII-free by construction)
// ---------------------------------------------------------------------------
// Saved payloads come from the core's serializeSession, whose whitelist copies
// only band/score primitives and numeric calibration — never names, never
// free-text input (even the label is generated). Everything stays in this
// browser's localStorage; nothing is uploaded.
const STORAGE_KEY = 'visioncheckr.savedSessions.v1';

const PRIVACY_NOTE =
  'No identity data is stored: a saved result contains only module bands, ' +
  'scores and calibration numbers, kept in this browser only. Nothing is uploaded.';

function readSavedSessions() {
  let raw = null;
  try { raw = window.localStorage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const sessions = [];
  for (const item of parsed) {
    try { sessions.push(deserializeSession(item)); } catch { /* skip corrupt entries */ }
  }
  return sessions;
}

function writeSavedSessions(sessions) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { /* storage unavailable */ }
}

function saveCurrentSession() {
  const sessions = readSavedSessions();
  const payload = serializeSession(coreSession(), {
    label: `Run ${sessions.length + 1}`,
    savedAt: new Date().toISOString(),
  });
  sessions.push(payload);
  writeSavedSessions(sessions);
  state.justSaved = true;
  render();
}

function openSaved() {
  state.savedFrom = state.step;
  state.compareIndex = null;
  goto('saved');
}

function updateStepper() {
  const idx = STEPS.indexOf(state.step);
  [...stepper.children].forEach((li, i) => {
    li.removeAttribute('aria-current');
    li.classList.remove('done');
    if (i === idx) li.setAttribute('aria-current', 'step');
    else if (i < idx) li.classList.add('done');
  });
}

// ---------------------------------------------------------------------------
// Screen: intro
// ---------------------------------------------------------------------------
function screenIntro() {
  const savedCount = readSavedSessions().length;
  return el('section', { class: 'panel' }, [
    el('h2', { text: 'Welcome' }),
    el('p', { class: 'lead', text:
      'VisionCheckR runs four quick self-checks: colour vision, distance acuity, ' +
      'astigmatism, and contrast sensitivity. It takes a few minutes and stays ' +
      'entirely on your device.' }),
    el('p', { text:
      'These checks are educational only. They cannot diagnose anything and are ' +
      'no substitute for a professional eye exam. If in doubt, book an appointment ' +
      'with an optometrist or ophthalmologist.' }),
    el('ul', {}, [
      el('li', { text: 'Wear the glasses/contacts you would normally use for the task.' }),
      el('li', { text: 'Use a well-lit room and a clean screen at full brightness.' }),
      el('li', { text: 'You will calibrate your screen with a bank card first.' }),
    ]),
    el('div', { class: 'row end' }, [
      savedCount ? el('button', { class: 'ghost view-saved', onClick: openSaved },
        `View saved results (${savedCount})`) : null,
      el('button', { class: 'primary', onClick: () => goto('calibrate') }, 'Start calibration'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Screen: calibration
// ---------------------------------------------------------------------------
function screenCalibrate() {
  const card = el('div', { id: 'calCard' });
  card.style.width = state.calibration.cardWidthPx + 'px';

  const readout = el('span', { class: 'progress-mini' });
  const setReadout = () => {
    readout.textContent =
      `${state.calibration.cardWidthPx} px wide  =>  ${ppmm().toFixed(2)} px/mm`;
  };
  setReadout();

  const slider = el('input', {
    type: 'range', min: '120', max: '640', step: '1',
    value: String(state.calibration.cardWidthPx),
    'aria-label': 'Adjust on-screen card width to match a real card',
    onInput: (e) => {
      state.calibration.cardWidthPx = Number(e.target.value);
      card.style.width = state.calibration.cardWidthPx + 'px';
      setReadout();
    },
  });

  const distInput = el('input', {
    type: 'number', min: '0.5', max: '6', step: '0.1',
    value: String(state.calibration.distanceM),
    'aria-label': 'Viewing distance in metres',
    onInput: (e) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v > 0) state.calibration.distanceM = v;
    },
  });

  return el('section', { class: 'panel' }, [
    el('h2', { text: '1. Calibrate your screen' }),
    el('p', { text:
      'Hold a standard bank/credit card (85.6 mm wide) flat against the screen and ' +
      'drag the slider until the blue box is exactly the same width as the card. ' +
      'This lets the acuity test size letters correctly.' }),
    el('div', { class: 'field' }, [card]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Card width' }), slider, el('div', {}, [readout]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'dist', text: 'Viewing distance for the acuity test (metres)' }),
      distInput,
      el('div', { class: 'hint', text:
        'Recommended: about 3 m (10 ft). Measure the distance from your eyes to the ' +
        'screen and enter it here. The default chart is designed for ' +
        `${DEFAULT_DESIGN_DISTANCE_M} m.` }),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost', onClick: () => goto('intro') }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary', onClick: () => goto('color') }, 'Continue to colour test'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Module: colour vision (deterministic confusion-line plates on canvas)
// ---------------------------------------------------------------------------
// The plates come precomputed from the pure plates.mjs generator: figure and
// ground colours sit on the protan/deutan/tritan confusion lines at matched
// luminance, the dot layout is seeded (no Math.random anywhere), and each
// non-control plate is tagged with the type it probes so the tested core's
// classifyColorTendency can read the response pattern. This function only
// paints the precomputed dots. Educational approximation only.
const COLOR_PLATES = buildConfusionPlateSet();

function drawPlate(canvas, plate) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size / 2 - 3;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = plate.background;
  ctx.fillRect(0, 0, size, size);
  for (const dot of plate.dots) {
    ctx.beginPath();
    ctx.arc(dot.x * size, dot.y * size, Math.max(1, dot.r * size), 0, Math.PI * 2);
    ctx.fillStyle = dot.color;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8a7a5c';
  ctx.stroke();
}

function screenColor() {
  const idx = state.colorIdx ?? 0;
  state.colorIdx = idx;
  state.colorResponses = state.colorResponses ?? [];

  const size = Math.min(300, Math.floor((window.innerWidth || 360) * 0.8));
  const canvas = el('canvas', { width: String(size), height: String(size),
    role: 'img', 'aria-label': 'Colour vision plate' });

  const input = el('input', { type: 'text', inputmode: 'numeric',
    autocomplete: 'off', placeholder: 'digits you see, or leave blank',
    'aria-label': 'What number do you see',
    value: state.colorResponses[idx] ?? '' });

  const submit = (val) => {
    state.colorResponses[idx] = val;
    if (idx + 1 < COLOR_PLATES.length) {
      state.colorIdx = idx + 1;
      render();
    } else {
      // Both judgements come from the tested core: the pass/fail tally and the
      // per-type tendency read from the confusion-line plate tags.
      state.results.color = tallyColorTest(COLOR_PLATES, state.colorResponses);
      state.results.colorTendency = classifyColorTendency(COLOR_PLATES, state.colorResponses);
      goto('acuity');
    }
  };

  const section = el('section', { class: 'panel' }, [
    el('h2', { text: '2. Colour vision' }),
    el('p', { text:
      'Read the number hidden in the dot pattern. If you cannot see a number, ' +
      'leave the box blank and continue. (These plates are generated along ' +
      'colour-confusion lines as an educational approximation - they are not a ' +
      'certified Ishihara test.)' }),
    el('div', { class: 'canvas-frame' }, [canvas]),
    el('div', { class: 'field' }, [
      el('label', { text: `Plate ${idx + 1} of ${COLOR_PLATES.length}` }),
      input,
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost', onClick: () => submit('') }, 'I see nothing'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary',
        onClick: () => submit(input.value) },
        idx + 1 < COLOR_PLATES.length ? 'Next plate' : 'Finish colour test'),
    ]),
  ]);

  // Draw after the canvas is in the DOM.
  queueMicrotask(() => drawPlate(canvas, COLOR_PLATES[idx]));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(input.value); });
  return section;
}

// ---------------------------------------------------------------------------
// Module: visual acuity (Snellen-style, calibrated)
// ---------------------------------------------------------------------------
const SLOAN = 'CDHKNORSVZ';
function sloanLetters(seed, count) {
  // Deterministic pseudo-random letters per line so re-renders are stable.
  let x = seed * 2654435761 % 2 ** 31;
  let out = '';
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += SLOAN[x % SLOAN.length];
  }
  return out;
}

function screenAcuity() {
  const ppm = ppmm();
  const distanceM = state.calibration.distanceM;

  const rows = SNELLEN_LINES.map((line, i) => {
    const hpx = snellenLetterHeightPx({ marArcmin: line.marArcmin, distanceM, pixelsPerMm: ppm });
    const clamped = Math.max(6, Math.min(hpx, 220)); // keep on-screen
    const letters = el('span', { class: 'letters' }, sloanLetters(i + 1, 5));
    letters.style.fontSize = clamped + 'px';
    const rowEl = el('div', {
      class: 'snellen-line' + (state.acuityLineIndex === i ? ' selected' : ''),
      role: 'button', tabindex: '0',
      'aria-pressed': String(state.acuityLineIndex === i),
      'aria-label': `Line ${line.snellen}, select if this is the smallest line you can read`,
      onClick: () => { state.acuityLineIndex = i; render(); },
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.acuityLineIndex = i; render(); } },
    }, [
      letters,
      el('span', { class: 'pick badge' + (state.acuityLineIndex === i ? ' good' : ''),
        text: state.acuityLineIndex === i ? 'selected' : line.snellen }),
    ]);
    if (hpx > 220) letters.title = 'Letters exceed screen size at this distance; move back or lower distance.';
    return rowEl;
  });

  const finish = () => {
    const li = Number.isInteger(state.acuityLineIndex) ? state.acuityLineIndex : -1;
    // The chart above is drawn FOR THE MEASURED DISTANCE: snellenLetterHeightPx
    // is given `distanceM`, so a 20/20 row already subtends exactly 1 arcmin per
    // stroke wherever the user is standing. Passing the 3 m design distance here
    // made acuityMetrics apply a SECOND correction of design/actual on top of
    // that, so the result was wrong for everyone not at exactly 3.0 m — while
    // the distance input invites 0.5 m to 6 m. At 1 m, 20/20 vision was reported
    // 20/60 "an eye test is advised"; at 6 m, 20/40 vision was reported 20/20
    // "typical", which is the false-reassurance direction and the one that
    // matters. Design and actual are the same thing here, so the scale is 1 and
    // the correction is applied exactly once, in the drawing.
    state.results.acuity = acuityScore({
      lineIndex: li,
      actualDistanceM: distanceM,
      designDistanceM: distanceM,
    });
    goto('astigmatism');
  };

  return el('section', { class: 'panel' }, [
    el('h2', { text: '3. Visual acuity (distance)' }),
    el('p', { text:
      `Stand about ${distanceM} m from the screen (as calibrated). Cover one eye ` +
      'if you like, and click the smallest line whose letters you can read clearly.' }),
    el('div', { class: 'field' }, rows),
    el('p', { class: 'hint', text:
      'Letters are sized from your card calibration and distance. If nothing is ' +
      'readable, just continue and it will be recorded as inconclusive.' }),
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost', onClick: () => goto('color') }, 'Back'),
      el('button', { class: 'ghost',
        onClick: () => { state.acuityLineIndex = undefined; render(); } }, 'Clear selection'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary', onClick: finish }, 'Finish acuity test'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Module: astigmatism fan / dial
// ---------------------------------------------------------------------------
const AXIS_OPTIONS = [
  { deg: 0, label: '0 / 180 (horizontal, 3-9 o clock)' },
  { deg: 30, label: '30 (1-7 o clock)' },
  { deg: 60, label: '60 (2-8 o clock)' },
  { deg: 90, label: '90 (vertical, 12-6 o clock)' },
  { deg: 120, label: '120 (10-4 o clock)' },
  { deg: 150, label: '150 (11-5 o clock)' },
];

function drawFan(canvas) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, R = size / 2 - 8;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(2, size * 0.008);
  for (let a = 0; a < 180; a += 15) {
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(rad) * R, cy - Math.sin(rad) * R);
    ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.03, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f6f8';
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.stroke();
}

function screenAstigmatism() {
  state.astigSelected = state.astigSelected ?? new Set();
  const size = Math.min(300, Math.floor((window.innerWidth || 360) * 0.8));
  const canvas = el('canvas', { width: String(size), height: String(size),
    role: 'img', 'aria-label': 'Astigmatism fan chart of radiating lines' });

  const toggles = AXIS_OPTIONS.map((opt) =>
    el('button', {
      'aria-pressed': String(state.astigSelected.has(opt.deg)),
      onClick: (e) => {
        if (state.astigSelected.has(opt.deg)) state.astigSelected.delete(opt.deg);
        else state.astigSelected.add(opt.deg);
        e.currentTarget.setAttribute('aria-pressed', String(state.astigSelected.has(opt.deg)));
      },
    }, opt.label));

  const finish = () => {
    state.results.astigmatism = astigmatismResult([...state.astigSelected]);
    goto('contrast');
  };

  const section = el('section', { class: 'panel' }, [
    el('h2', { text: '4. Astigmatism fan' }),
    el('p', { text:
      'Look at the centre of the fan (one eye at a time). If all lines look ' +
      'equally black and sharp, do not select anything. If some directions look ' +
      'darker, bolder, or sharper than others, toggle those directions below.' }),
    el('div', { class: 'canvas-frame' }, [canvas]),
    el('p', { class: 'hint', text: 'Select every direction that stands out (or none):' }),
    el('div', { class: 'axis-grid' }, toggles),
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost', onClick: () => goto('acuity') }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary', onClick: finish }, 'Finish astigmatism test'),
    ]),
  ]);

  queueMicrotask(() => drawFan(canvas));
  return section;
}

// ---------------------------------------------------------------------------
// Module: contrast sensitivity (Landolt C at decreasing contrast)
// ---------------------------------------------------------------------------
// The background the Landolt C is drawn on, as an sRGB code value.
//
// Raised from 128. Michelson contrast is defined on LUMINANCE, and this module
// used to compute it on gamma-encoded code values, which overstated sensitivity
// by a uniform factor of 2.16 (+0.334 logCS) across the whole ladder: the
// faintest step believed it was logCS 1.926 and was truly 1.592.
//
// Correcting the formula alone was not enough, because at background 128 the
// integer offsets step straight OVER the "typical" threshold of logCS 1.8 -
// offset 2 gives 1.769 and offset 1 gives 2.072, with nothing in between. A
// perfect run could not have reached "typical" at all, and the only rung above
// the threshold was a one-code-value ring most displays will not render
// faithfully. At a brighter background the same one-code step is a smaller
// RELATIVE luminance step, so the rungs land where they are needed: at 225 the
// two faintest are logCS 1.82 and 2.00, both real 2- and 3-code rings.
const CONTRAST_BG = 225;

// High -> low contrast. Re-derived at CONTRAST_BG so the TRUE luminance logCS
// values reproduce the ladder this test was always meant to present:
//   0.27  0.56  0.81  1.08  1.29  1.52  1.82  2.00
// which is, to two decimals, what the old ladder BELIEVED it was presenting.
// The band thresholds are therefore unchanged; only the stimulus now matches
// them.
const CONTRAST_OFFSETS = [95, 50, 29, 16, 10, 6, 3, 2];
const GAP_DIRS = ['up', 'right', 'down', 'left'];

function michelson(offset) {
  // Michelson on LUMINANCE: (Lmax - Lmin) / (Lmax + Lmin), decoding both code
  // values through the sRGB EOTF first. Computing this on code values instead
  // is what overstated every reported contrast sensitivity.
  const bg = gammaDecode(CONTRAST_BG / 255);
  const ring = gammaDecode(Math.max(0, CONTRAST_BG - offset) / 255);
  return (bg - ring) / (bg + ring);
}

function buildContrastTrials() {
  return CONTRAST_OFFSETS.map((offset, i) => ({
    offset,
    contrast: michelson(offset),
    gap: GAP_DIRS[(i * 3 + 1) % 4], // deterministic-ish varied direction
  }));
}

function drawLandolt(canvas, offset, gapDir) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${CONTRAST_BG},${CONTRAST_BG},${CONTRAST_BG})`;
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const outer = size * 0.32, inner = size * 0.18;
  const lum = Math.max(0, CONTRAST_BG - offset);
  ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
  // Ring = outer disc minus inner disc minus a gap wedge.
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  // Punch the gap by painting background over a wedge.
  const dirAngle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[gapDir];
  const half = 0.32; // radians half-width of gap
  ctx.fillStyle = `rgb(${CONTRAST_BG},${CONTRAST_BG},${CONTRAST_BG})`;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, outer + 2, dirAngle - half, dirAngle + half);
  ctx.closePath();
  ctx.fill();
}

function screenContrast() {
  state.contrastTrials = state.contrastTrials ?? buildContrastTrials();
  state.contrastIdx = state.contrastIdx ?? 0;
  state.contrastAnswers = state.contrastAnswers ?? [];
  const idx = state.contrastIdx;
  const trial = state.contrastTrials[idx];

  const size = Math.min(280, Math.floor((window.innerWidth || 360) * 0.75));
  const canvas = el('canvas', { width: String(size), height: String(size),
    role: 'img', 'aria-label': 'Contrast target: a ring with a gap' });

  const answer = (dir) => {
    const correct = dir === trial.gap;
    state.contrastAnswers[idx] = { contrast: trial.contrast, correct };
    if (idx + 1 < state.contrastTrials.length) {
      state.contrastIdx = idx + 1;
      render();
    } else {
      // Trials are already ordered high -> low contrast.
      state.results.contrast = contrastThreshold(state.contrastAnswers);
      goto('summary');
    }
  };

  const pad = el('div', { class: 'dpad' }, [
    el('button', { class: 'up', 'aria-label': 'gap points up', onClick: () => answer('up') }, '▲'),
    el('button', { class: 'left', 'aria-label': 'gap points left', onClick: () => answer('left') }, '◀'),
    el('button', { class: 'right', 'aria-label': 'gap points right', onClick: () => answer('right') }, '▶'),
    el('button', { class: 'down', 'aria-label': 'gap points down', onClick: () => answer('down') }, '▼'),
  ]);

  const section = el('section', { class: 'panel' }, [
    el('h2', { text: '5. Contrast sensitivity' }),
    el('p', { text:
      'A faint ring has a gap on one side. Pick the direction of the gap. The ring ' +
      'gets fainter each time. If you cannot tell, make your best guess.' }),
    el('div', { class: 'canvas-frame' }, [canvas]),
    el('div', { class: 'progress-mini', text: `Target ${idx + 1} of ${state.contrastTrials.length}` }),
    pad,
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost', onClick: () => goto('astigmatism') }, 'Back'),
    ]),
  ]);

  queueMicrotask(() => drawLandolt(canvas, trial.offset, trial.gap));
  return section;
}

// ---------------------------------------------------------------------------
// Screen: summary
// ---------------------------------------------------------------------------
function bandBadge(band) {
  const good = band === 'typical';
  return el('span', { class: 'badge ' + (good ? 'good' : 'flag'),
    text: band ?? 'n/a' });
}

// ---------------------------------------------------------------------------
// Report download
// ---------------------------------------------------------------------------
// The report content comes entirely from the tested deterministic core; the UI
// injects the one impure input (the current time) as a parameter and hands the
// rendered bytes to a Blob. The file downloads straight from this tab —
// nothing is uploaded anywhere.
function downloadReport(format) {
  const report = buildReport(coreSession(), { generatedAt: new Date().toISOString() });
  const isJson = format === 'json';
  const content = isJson ? reportToJson(report) : reportToText(report);
  const blob = new Blob([content], { type: isJson ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: isJson ? 'visioncheckr-report.json' : 'visioncheckr-report.txt' });
  appRoot.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Render the core's whole-run reliability verdict. The judgement (band, issues,
// note) all comes from assessReliability; this only displays it. A partial or
// unreliable run is honestly presented as inconclusive, with the reasons.
function reliabilityPanel(rel) {
  const issues = rel.issues.map((issue) =>
    el('li', { text: `${issue.module}: ${issue.reason}` }));
  return el('div', {
    class: 'reliability ' + rel.band,
    role: 'note',
    'aria-label': 'Run reliability',
  }, [
    el('div', { class: 'row' }, [
      el('strong', { text: 'Run reliability' }),
      el('span', {
        class: 'badge ' + (rel.band === 'reliable' ? 'good' : 'flag'),
        text: rel.band,
      }),
    ]),
    rel.band === 'reliable' ? null : el('p', { class: 'reliability-verdict', text:
      rel.band === 'unreliable'
        ? 'Treat this whole run as inconclusive: the module results below should not be relied on.'
        : 'Treat the flagged checks below as inconclusive.' }),
    el('p', { text: rel.note }),
    issues.length ? el('ul', { class: 'reliability-issues' }, issues) : null,
  ]);
}

// Render the colour-vision tendency read-out from the core's
// classifyColorTendency. All judgement (tendency, confidence, per-type tallies,
// the not-a-diagnosis note) comes from the core; this only displays it, and an
// inconclusive read stays honestly inconclusive.
function tendencyLine(ln, ct) {
  const tendency = ct?.tendency ?? 'inconclusive';
  const clear = tendency === 'none';
  const perType = ct?.perType ?? {};
  const breakdown = ['protan', 'deutan', 'tritan']
    .map((t) => `${t} ${perType[t]?.missed ?? 0}/${perType[t]?.total ?? 0}`)
    .join(', ');
  const withConfidence = tendency.endsWith('-leaning') || tendency === 'mixed'
    ? ` Confidence: ${ct?.confidence ?? 'low'} - a screening lean, never a diagnosis.`
    : '';
  return el('div', { class: 'result-line tendency-line' + (clear ? '' : ' flag') }, [
    el('div', { class: 'row' }, [
      el('strong', { text: ln.module }), ' ',
      el('span', { class: 'badge tendency-badge ' + (clear ? 'good' : 'flag'), text: tendency }),
    ]),
    el('div', { text: ln.text }),
    el('div', { class: 'hint', text:
      `Confusion-line plates missed: ${breakdown}.${withConfidence}` }),
  ]);
}

function screenSummary() {
  state.results.reliability = assessReliability(coreSession());
  const s = summarize(state.results);
  const savedCount = readSavedSessions().length;

  const lines = s.lines.filter((ln) => ln.module !== 'Reliability').map((ln) => {
    const r = state.results;
    // Handled first: 'Colour-vision tendency' also startsWith('Colour') and must
    // not inherit the colour tally's band.
    if (ln.module === 'Colour-vision tendency') return tendencyLine(ln, r.colorTendency);
    let band = 'n/a';
    if (ln.module.startsWith('Visual')) band = r.acuity?.band;
    else if (ln.module.startsWith('Colour')) band = r.color?.band;
    else if (ln.module.startsWith('Astig')) band = r.astigmatism?.band;
    else if (ln.module.startsWith('Contrast')) band = r.contrast?.band;
    const flagged = band && band !== 'typical';
    return el('div', { class: 'result-line' + (flagged ? ' flag' : '') }, [
      el('div', { class: 'row' }, [
        el('strong', { text: ln.module }), ' ', bandBadge(band),
      ]),
      el('div', { text: ln.text }),
    ]);
  });

  const detail = [];
  if (state.results.acuity?.readable) {
    detail.push(`Acuity estimate: ${state.results.acuity.snellen} (logMAR ${state.results.acuity.logMAR}).`);
  }
  if (state.results.color) {
    detail.push(`Colour plates read correctly: ${state.results.color.correct}/${state.results.color.total}.`);
  }
  if (state.results.contrast?.thresholdContrast != null) {
    detail.push(`Contrast threshold ~${state.results.contrast.thresholdPercent}% (log CS ${state.results.contrast.logCS}).`);
  }

  return el('section', { class: 'panel' }, [
    el('h2', { text: '6. Your summary (educational, not a diagnosis)' }),
    el('div', { class: 'headline', text: s.headline }),
    reliabilityPanel(state.results.reliability),
    ...lines,
    detail.length ? el('p', { class: 'hint', text: detail.join('  ') }) : null,
    el('div', { class: 'field download-block' }, [
      el('h3', { text: 'Download my report' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'download-text', onClick: () => downloadReport('text') }, 'Download as text'),
        el('button', { class: 'download-json', onClick: () => downloadReport('json') }, 'Download as JSON'),
      ]),
      el('p', { class: 'hint', text:
        'The report is generated on your device and downloads straight from this ' +
        'tab. It embeds the educational disclaimer; nothing is uploaded.' }),
    ]),
    el('div', { class: 'field save-block' }, [
      el('h3', { text: 'Save and compare on this device' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'save-session', onClick: saveCurrentSession }, 'Save this result'),
        state.justSaved ? el('span', { class: 'badge good save-confirm', text: 'saved' }) : null,
        savedCount ? el('button', { class: 'ghost view-saved', onClick: openSaved },
          `View saved results (${savedCount})`) : null,
      ]),
      el('p', { class: 'hint', text: PRIVACY_NOTE }),
    ]),
    el('div', { class: 'disclaimer', role: 'note' }, [
      el('strong', { text: 'Important: ' }),
      s.recommendation + ' ' + s.disclaimer,
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost restart', onClick: restart }, 'Start over'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary', onClick: () => window.print() }, 'Print / save my results'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Screen: saved results + comparison (local only)
// ---------------------------------------------------------------------------
function screenSaved() {
  const sessions = readSavedSessions();
  const newestIndex = sessions.length - 1;

  const items = sessions.map((sess, i) => {
    const bands = Object.entries(sess.modules)
      .map(([name, fields]) => `${name}: ${fields.band ?? fields.tendency ?? 'n/a'}`)
      .join('  ');
    const label = sess.label ?? `Saved run ${i + 1}`;
    return el('div', { class: 'saved-item' }, [
      el('div', { class: 'row' }, [
        el('strong', { text: label }),
        el('span', { class: 'progress-mini', text: sess.savedAt ?? 'time not recorded' }),
        i === newestIndex ? el('span', { class: 'badge good', text: 'most recent' }) : null,
      ]),
      el('div', { class: 'hint', text: bands }),
      el('div', { class: 'row' }, [
        i !== newestIndex ? el('button', {
          class: 'compare-session',
          'aria-label': `Compare ${label} with the most recent saved run`,
          onClick: () => { state.compareIndex = i; render(); },
        }, 'Compare with most recent') : null,
        el('button', {
          class: 'ghost delete-session',
          'aria-label': `Delete ${label}`,
          onClick: () => {
            sessions.splice(i, 1);
            writeSavedSessions(sessions);
            state.compareIndex = null;
            render();
          },
        }, 'Delete'),
      ]),
    ]);
  });

  // Comparison view: the selected earlier run against the most recent one. The
  // trend judgement comes entirely from the core's compareSessions.
  let comparison = null;
  if (
    state.compareIndex != null &&
    state.compareIndex !== newestIndex &&
    sessions[state.compareIndex] &&
    sessions.length >= 2
  ) {
    const prev = sessions[state.compareIndex];
    const cmp = compareSessions(prev, sessions[newestIndex]);
    comparison = el('div', { class: 'comparison', role: 'note', 'aria-label': 'Comparison of two saved runs' }, [
      el('h3', { text: `Comparison: ${prev.label ?? 'earlier run'} vs most recent` }),
      cmp.changes.length
        ? el('ul', { class: 'comparison-changes' }, cmp.changes.map((c) =>
            el('li', { class: 'change-' + c.direction,
              text: `${c.module}: ${c.from} -> ${c.to} (${c.direction})` })))
        : el('p', { text: 'These two runs had no comparable module bands.' }),
      el('p', { class: 'hint', text: cmp.note }),
    ]);
  }

  return el('section', { class: 'panel' }, [
    el('h2', { text: 'Saved results (this device only)' }),
    el('p', { class: 'hint', text: PRIVACY_NOTE }),
    sessions.length
      ? el('div', {}, items)
      : el('p', { class: 'saved-empty', text:
          'No saved results yet. Finish a run and save it from the summary screen.' }),
    comparison,
    el('div', { class: 'row' }, [
      el('button', { class: 'ghost saved-back', onClick: () => goto(state.savedFrom ?? 'intro') }, 'Back'),
      el('span', { class: 'spacer' }),
      sessions.length ? el('button', {
        class: 'ghost delete-all',
        onClick: () => {
          writeSavedSessions([]);
          state.compareIndex = null;
          render();
        },
      }, 'Delete all saved results') : null,
    ]),
  ]);
}

function restart() {
  state.step = 'intro';
  state.results = {};
  state.colorIdx = 0;
  state.colorResponses = [];
  state.acuityLineIndex = undefined;
  state.astigSelected = new Set();
  state.contrastTrials = null;
  state.contrastIdx = 0;
  state.contrastAnswers = [];
  state.justSaved = false;
  state.compareIndex = null;
  render();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function render() {
  updateStepper();
  appRoot.replaceChildren();
  let screen;
  switch (state.step) {
    case 'intro': screen = screenIntro(); break;
    case 'calibrate': screen = screenCalibrate(); break;
    case 'color': screen = screenColor(); break;
    case 'acuity': screen = screenAcuity(); break;
    case 'astigmatism': screen = screenAstigmatism(); break;
    case 'contrast': screen = screenContrast(); break;
    case 'summary': screen = screenSummary(); break;
    case 'saved': screen = screenSaved(); break;
    default: screen = screenIntro();
  }
  appRoot.append(screen);
}

// Expose a tiny bit for manual/debug use without leaking internals.
window.VisionCheckR = { state, DISCLAIMER };

render();
