// test/app.smoke.test.mjs
// Headless smoke test: drives the real app.js UI controller through every step
// using a tiny hand-rolled DOM/canvas stub (zero dependencies — no jsdom).
// This proves the router, canvas draw calls and module wiring actually run and
// that each module populates a result, not just that the file parses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure modules (no DOM): safe to import before the stub below is installed.
import { buildConfusionPlateSet } from '../plates.mjs';
import { SNELLEN_LINES, pixelsPerMm, snellenLetterHeightPx } from '../scoring.mjs';

// --- minimal fake DOM ------------------------------------------------------

function makeText(value) {
  return { nodeType: 3, textContent: String(value) };
}

function fakeCtx() {
  return new Proxy(
    {},
    {
      get(_t, p) {
        if (p === 'getImageData') {
          return (x, y, w, h) => ({
            data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)),
          });
        }
        return () => {}; // every method is a no-op
      },
      set() {
        return true; // fillStyle, font, lineWidth, ... assignments accepted
      },
    }
  );
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    attributes: {},
    dataset: {},
    style: {},
    _listeners: {},
    className: '',
    value: '',
    _ownText: '',
  };
  node.classList = {
    add: (...c) => {
      const s = new Set(node.className.split(/\s+/).filter(Boolean));
      c.forEach((x) => s.add(x));
      node.className = [...s].join(' ');
    },
    remove: (...c) => {
      const s = new Set(node.className.split(/\s+/).filter(Boolean));
      c.forEach((x) => s.delete(x));
      node.className = [...s].join(' ');
    },
    contains: (c) => node.className.split(/\s+/).includes(c),
  };
  node.setAttribute = (k, v) => {
    node.attributes[k] = String(v);
    if (k === 'width' || k === 'height') node[k] = Number(v);
    if (k === 'value') node.value = String(v);
  };
  node.getAttribute = (k) => (k in node.attributes ? node.attributes[k] : null);
  node.removeAttribute = (k) => {
    delete node.attributes[k];
  };
  node.addEventListener = (t, fn) => {
    (node._listeners[t] = node._listeners[t] || []).push(fn);
  };
  node.append = (...kids) => {
    for (const k of kids) {
      const kn = k && k.nodeType ? k : makeText(k);
      node.children.push(kn);
      kn.parentNode = node;
    }
  };
  node.replaceChildren = (...kids) => {
    node.children = [];
    node.append(...kids);
  };
  node.remove = () => {
    if (node.parentNode) {
      node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      node.parentNode = null;
    }
  };
  node.getContext = () => fakeCtx();
  node.dispatch = (type, ev) =>
    (node._listeners[type] || [])
      .slice()
      .forEach((fn) => fn(ev || { target: node, currentTarget: node, preventDefault() {} }));
  node.click = () => node.dispatch('click');
  Object.defineProperty(node, 'textContent', {
    get() {
      let t = node._ownText || '';
      for (const c of node.children) t += c.textContent || '';
      return t;
    },
    set(v) {
      node._ownText = String(v);
      node.children = [];
    },
  });
  return node;
}

// Build the document skeleton index.html provides.
const registry = {};
const appRoot = makeNode('main');
registry.app = appRoot;
const stepper = makeNode('ol');
for (const step of ['intro', 'calibrate', 'color', 'acuity', 'astigmatism', 'contrast', 'summary']) {
  const li = makeNode('li');
  li.dataset.step = step;
  stepper.children.push(li);
}
registry.stepper = stepper;

globalThis.document = {
  createElement: (t) => makeNode(t),
  createTextNode: (v) => makeText(v),
  getElementById: (id) => registry[id],
};
// localStorage: a Map-backed stub so the save/compare flow can persist across
// simulated restarts within the test process.
const localStore = new Map();
globalThis.window = {
  scrollTo() {},
  innerWidth: 800,
  print() {},
  localStorage: {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => { localStore.set(k, String(v)); },
    removeItem: (k) => { localStore.delete(k); },
    clear: () => { localStore.clear(); },
  },
};

// Downloads: capture every Blob handed to createObjectURL (Node has a real
// Blob, so the test can read the exact bytes the browser would save).
const capturedDownloads = [];
let revokedUrls = 0;
globalThis.URL.createObjectURL = (blob) => {
  capturedDownloads.push(blob);
  return `blob:visioncheckr-test-${capturedDownloads.length}`;
};
globalThis.URL.revokeObjectURL = () => { revokedUrls++; };

// --- traversal helpers -----------------------------------------------------

function walk(node, fn) {
  if (!node) return;
  fn(node);
  for (const c of node.children || []) if (c.nodeType === 1) walk(c, fn);
}
function findByClass(cls) {
  let found = null;
  walk(appRoot, (n) => {
    if (!found && String(n.className).split(/\s+/).includes(cls)) found = n;
  });
  return found;
}
function findAllByClass(cls) {
  const found = [];
  walk(appRoot, (n) => {
    if (String(n.className).split(/\s+/).includes(cls)) found.push(n);
  });
  return found;
}
function findByAriaLabel(label) {
  let found = null;
  walk(appRoot, (n) => {
    if (!found && n.attributes && n.attributes['aria-label'] === label) found = n;
  });
  return found;
}
function clickClass(cls) {
  const n = findByClass(cls);
  if (!n) throw new Error(`no element with class "${cls}" in current screen`);
  n.dispatch('click');
}

// Drive one whole run from the intro screen to the summary. Options control the
// answers so tests can steer the verdicts the summary should render. The colour
// plates and their answers come from the same deterministic confusion-line set
// the app renders (plates.mjs), so this cannot drift from the UI.
const PLATES = buildConfusionPlateSet();
const PLATE_ANSWERS = PLATES.map((p) => p.answer);

function completeRun({
  correctColor = false,
  distanceValue = 3,
  smallestLine = false,
  colorAnswerFor = null, // (plate, i) => response string; overrides correctColor
} = {}) {
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.step, 'intro');
  clickClass('primary'); // intro -> calibrate
  // Calibration persists across Start over, so set the distance every run.
  const dist = findByAriaLabel('Viewing distance in metres');
  dist.dispatch('input', { target: { value: String(distanceValue) } });
  clickClass('primary'); // calibrate -> colour
  for (let i = 0; i < PLATES.length; i++) {
    const answer = colorAnswerFor
      ? colorAnswerFor(PLATES[i], i)
      : (correctColor ? PLATE_ANSWERS[i] : '');
    if (answer !== '') findByAriaLabel('What number do you see').value = answer;
    clickClass('primary');
  }
  const lines = findAllByClass('snellen-line');
  (smallestLine ? lines[lines.length - 1] : lines[0]).dispatch('click');
  clickClass('primary'); // finish acuity -> astigmatism
  clickClass('primary'); // astigmatism (nothing selected) -> contrast
  const nTrials = state.contrastTrials.length;
  for (let i = 0; i < nTrials; i++) clickClass(state.contrastTrials[state.contrastIdx].gap);
  assert.equal(state.step, 'summary');
}

// --- the smoke flow --------------------------------------------------------

test('app.js drives the whole flow and every module records a result', async () => {
  await import('../app.js'); // render() runs on import -> intro screen

  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.step, 'intro');

  clickClass('primary'); // intro -> calibrate
  assert.equal(state.step, 'calibrate');

  clickClass('primary'); // calibrate -> colour
  assert.equal(state.step, 'color');

  for (let i = 0; i < PLATES.length; i++) clickClass('primary'); // all plates -> acuity
  assert.equal(state.step, 'acuity');
  assert.ok(state.results.color, 'colour result recorded');
  assert.ok(state.results.colorTendency, 'colour tendency recorded from the tagged plates');

  clickClass('snellen-line'); // pick smallest readable line (index 0)
  clickClass('primary'); // finish acuity -> astigmatism
  assert.equal(state.step, 'astigmatism');
  assert.ok(state.results.acuity && state.results.acuity.readable, 'acuity readable');

  clickClass('primary'); // finish astigmatism (nothing selected) -> contrast
  assert.equal(state.step, 'contrast');
  assert.ok(state.results.astigmatism, 'astigmatism result recorded');
  assert.equal(state.results.astigmatism.indicatesAstigmatism, false);

  // Answer every contrast trial (count is derived so this stays correct if the
  // staircase length changes).
  const nContrastTrials = state.contrastTrials.length;
  for (let i = 0; i < nContrastTrials; i++) clickClass('up');
  assert.equal(state.step, 'summary');
  assert.ok(state.results.contrast, 'contrast result recorded');

  // Summary screen actually rendered with the disclaimer text.
  assert.match(appRoot.textContent, /not a diagnosis/i);
  assert.match(appRoot.textContent, /optometrist or ophthalmologist/i);

  // Flush any queued canvas-draw microtasks so a stub error would surface.
  await new Promise((r) => setImmediate(r));
});

test('contrast: a fully-correct run is achievable and scores in the typical band', () => {
  // Regression: with the old staircase the faintest target topped out at
  // logCS 1.799, so even a perfect run was scored "borderline" and always
  // flagged. A perfect run must be able to reach "typical".
  const state = globalThis.window.VisionCheckR.state;

  // The previous test left us on the summary; its "Start over" (ghost) button
  // resets the app back to the intro screen.
  if (state.step !== 'intro') clickClass('ghost');
  assert.equal(state.step, 'intro');

  clickClass('primary'); // intro -> calibrate
  clickClass('primary'); // calibrate -> colour
  for (let i = 0; i < PLATES.length; i++) clickClass('primary'); // colour plates -> acuity
  clickClass('snellen-line'); // pick a readable line
  clickClass('primary'); // acuity -> astigmatism
  clickClass('primary'); // astigmatism (nothing selected) -> contrast
  assert.equal(state.step, 'contrast');

  // Answer each trial with its actual gap direction (a perfect run).
  const nTrials = state.contrastTrials.length;
  for (let i = 0; i < nTrials; i++) {
    const gap = state.contrastTrials[state.contrastIdx].gap; // 'up'|'down'|'left'|'right'
    clickClass(gap); // dpad button classes match the direction names
  }

  assert.equal(state.step, 'summary');
  assert.equal(
    state.results.contrast.band,
    'typical',
    'a fully-correct contrast run must be achievable and score typical'
  );
});

// --- reliability panel (v2 core assessReliability wired into the summary) ---

test('reliability panel: a control-failed run renders the partial verdict with its reason', () => {
  const state = globalThis.window.VisionCheckR.state;
  // The previous test left a completed run on the summary whose colour plates
  // were all left blank, so the control plate was missed.
  assert.equal(state.step, 'summary');
  const panel = findByClass('reliability');
  assert.ok(panel, 'reliability panel rendered on the summary');
  assert.ok(panel.className.split(/\s+/).includes('partial'), 'control failure -> partial verdict');
  assert.match(panel.textContent, /control plate/i, 'the reason is shown');
  assert.match(panel.textContent, /inconclusive/i, 'honestly marked inconclusive');
});

test('reliability panel: a clean fully-correct run renders the reliable verdict', () => {
  clickClass('restart');
  completeRun({ correctColor: true, smallestLine: true });
  const panel = findByClass('reliability');
  assert.ok(panel, 'reliability panel rendered on the summary');
  assert.ok(panel.className.split(/\s+/).includes('reliable'), 'clean run -> reliable verdict');
  assert.match(panel.textContent, /internally consistent/i);
});

test('reliability panel: an implausible viewing distance renders the unreliable verdict with the reason', () => {
  clickClass('restart');
  completeRun({ correctColor: true, smallestLine: true, distanceValue: 0.05 });
  const panel = findByClass('reliability');
  assert.ok(panel, 'reliability panel rendered on the summary');
  assert.ok(panel.className.split(/\s+/).includes('unreliable'), 'bad calibration -> unreliable verdict');
  assert.match(panel.textContent, /viewing distance looks implausible/i, 'the reason is shown');
  assert.match(panel.textContent, /inconclusive/i, 'honestly marked inconclusive');
});

// --- report download (buildReport + reportToText/Json via a Blob) -----------

test('download my report as text: the deterministic core report with an injected timestamp', async () => {
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.step, 'summary'); // left there by the reliability tests
  capturedDownloads.length = 0;
  revokedUrls = 0;
  clickClass('download-text');
  assert.equal(capturedDownloads.length, 1, 'one blob handed to createObjectURL');
  const blob = capturedDownloads[0];
  assert.equal(blob.type, 'text/plain');
  const text = await blob.text();
  assert.match(text, /VisionCheckR vision self-check report/);
  assert.match(text, /not a medical device/i, 'disclaimer embedded');
  assert.match(text, /Generated at: \d{4}-\d{2}-\d{2}T/, 'the UI injected a real timestamp');
  assert.equal(revokedUrls, 1, 'the object URL is revoked after the click');
});

test('download my report as JSON: parseable, schema-tagged, disclaimer embedded', async () => {
  capturedDownloads.length = 0;
  clickClass('download-json');
  assert.equal(capturedDownloads.length, 1, 'one blob handed to createObjectURL');
  const blob = capturedDownloads[0];
  assert.equal(blob.type, 'application/json');
  const report = JSON.parse(await blob.text());
  assert.equal(report.schemaVersion, '1.0');
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.disclaimer, /not a medical device/i);
  assert.ok(Array.isArray(report.lines) && report.lines.length > 0, 'module lines present');
});

// --- PII-free save / compare (serializeSession + compareSessions) -----------

const STORAGE_KEY = 'visioncheckr.savedSessions.v1';

test('save this result: a PII-free whitelisted payload lands in localStorage with a visible no-identity note', () => {
  clickClass('restart');
  completeRun({ correctColor: true, smallestLine: true }); // everything typical
  assert.match(appRoot.textContent, /No identity data is stored/);
  clickClass('save-session');
  assert.ok(findByClass('save-confirm'), 'a visible saved confirmation appears');
  const raw = globalThis.window.localStorage.getItem(STORAGE_KEY);
  assert.ok(raw, 'payload persisted');
  const saved = JSON.parse(raw);
  assert.equal(saved.length, 1);
  const entry = saved[0];
  assert.deepEqual(Object.keys(entry).sort(),
    ['calibration', 'label', 'modules', 'savedAt', 'schemaVersion']);
  assert.equal(entry.label, 'Run 1'); // generated label, never free-text input
  assert.equal(entry.modules.acuity.band, 'typical');
  // PII-free by construction: no per-plate answers, notes or free text survive
  // the whitelist serialization.
  for (const leak of ['perPlate', 'given', 'expected', 'note', 'responses']) {
    assert.equal(raw.includes(leak), false, `serialized payload must not contain ${leak}`);
  }
});

test('reload -> saved view -> compare -> delete: the local flow works from storage alone', () => {
  const state = globalThis.window.VisionCheckR.state;
  clickClass('restart'); // fresh start: in-memory results wiped, storage remains
  assert.equal(state.step, 'intro');
  assert.ok(findByClass('view-saved'), 'saved results reachable from the intro after a restart');
  clickClass('view-saved');
  assert.equal(state.step, 'saved');
  assert.match(appRoot.textContent, /Run 1/);
  assert.match(appRoot.textContent, /No identity data is stored/);
  clickClass('saved-back');
  assert.equal(state.step, 'intro');

  completeRun({ correctColor: true, smallestLine: false }); // worse acuity this time
  clickClass('save-session');
  clickClass('view-saved');
  assert.equal(state.step, 'saved');
  clickClass('compare-session'); // Run 1 vs the most recent (Run 2)
  const comparison = findByClass('comparison');
  assert.ok(comparison, 'comparison view rendered');
  assert.match(comparison.textContent, /acuity: typical -> notably-reduced \(worse\)/);
  assert.match(comparison.textContent, /not a diagnosis/i);

  clickClass('delete-session'); // delete Run 1
  assert.equal(JSON.parse(globalThis.window.localStorage.getItem(STORAGE_KEY)).length, 1);
  clickClass('delete-all');
  assert.equal(JSON.parse(globalThis.window.localStorage.getItem(STORAGE_KEY)).length, 0);
  assert.ok(findByClass('saved-empty'), 'empty state shown after deleting everything');
});

// --- colour-vision tendency (confusion-line plates -> classifyColorTendency) --

// The previous tests can leave the app on the saved screen (whose Back returns
// to wherever it was opened from), so walk defensively back to the intro.
function backToIntro() {
  const state = globalThis.window.VisionCheckR.state;
  if (state.step === 'saved') clickClass('saved-back');
  if (state.step !== 'intro') clickClass('restart');
  assert.equal(state.step, 'intro');
}

test('colour tendency: an all-correct run shows none and adds no flag', () => {
  backToIntro();
  completeRun({ correctColor: true, smallestLine: true });
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.results.colorTendency.tendency, 'none');
  const line = findByClass('tendency-line');
  assert.ok(line, 'the tendency read-out renders on the summary');
  assert.equal(line.className.split(/\s+/).includes('flag'), false, 'no tendency -> not flagged');
  const badge = findByClass('tendency-badge');
  assert.equal(badge.textContent, 'none');
  assert.ok(badge.className.split(/\s+/).includes('good'));
  assert.match(line.textContent, /protan 0\/2, deutan 0\/3, tritan 0\/2/,
    'the per-type breakdown reflects the full tagged set');
});

test('colour tendency: missing every deutan plate surfaces deutan-leaning honestly', () => {
  backToIntro();
  completeRun({ smallestLine: true, colorAnswerFor: (p) => (p.probes === 'deutan' ? '' : p.answer) });
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.results.colorTendency.tendency, 'deutan-leaning');
  assert.equal(state.results.colorTendency.confidence, 'moderate');
  const line = findByClass('tendency-line');
  assert.ok(line, 'the tendency read-out renders on the summary');
  assert.ok(line.className.split(/\s+/).includes('flag'), 'a leaning is flagged for follow-up');
  assert.equal(findByClass('tendency-badge').textContent, 'deutan-leaning');
  assert.match(line.textContent, /deutan 3\/3/, 'the per-type miss tally is shown');
  assert.match(line.textContent, /confidence: moderate/i);
  assert.match(line.textContent, /not a diagnosis/i, 'honest non-diagnostic wording');
  // The colour control passed, so the run itself still counts as reliable.
  const rel = findByClass('reliability');
  assert.ok(rel.className.split(/\s+/).includes('reliable'));
});

test('colour tendency: a missed control stays inconclusive and degrades reliability', () => {
  backToIntro();
  completeRun({ smallestLine: true, colorAnswerFor: (p) => (p.control ? '' : p.answer) });
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.results.colorTendency.tendency, 'inconclusive');
  const badge = findByClass('tendency-badge');
  assert.equal(badge.textContent, 'inconclusive');
  assert.equal(badge.className.split(/\s+/).includes('good'), false);
  const rel = findByClass('reliability');
  assert.ok(rel.className.split(/\s+/).includes('partial'), 'control failure degrades the run verdict');
  assert.match(rel.textContent, /control plate/i);
});

test('colour tendency: saving keeps only the whitelisted tendency fields', () => {
  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.step, 'summary'); // left there by the previous test
  backToIntro();
  completeRun({ smallestLine: true, colorAnswerFor: (p) => (p.probes === 'deutan' ? '' : p.answer) });
  clickClass('save-session');
  const raw = globalThis.window.localStorage.getItem(STORAGE_KEY);
  const saved = JSON.parse(raw);
  const entry = saved[saved.length - 1];
  assert.deepEqual(entry.modules.colorTendency, { tendency: 'deutan-leaning', confidence: 'moderate' });
  for (const leak of ['perType', 'missed', 'note', 'probes']) {
    assert.equal(raw.includes(leak), false, `serialized payload must not contain ${leak}`);
  }
  clickClass('view-saved');
  assert.match(appRoot.textContent, /colorTendency: deutan-leaning/, 'saved view surfaces the tendency');
  clickClass('delete-all');
});

// --- acuity must not depend on where the user stands ------------------------

test('acuity: the same line gives the same verdict at 1 m and at 6 m', () => {
  // Regression. The chart is drawn FOR THE MEASURED DISTANCE, then the scorer
  // was told it had been drawn for 3 m, so the distance correction was applied
  // twice and the result was right only at exactly 3.0 m — while the input
  // invites 0.5 m to 6 m. Measured before the fix, picking the 20/20 line:
  // 1 m reported 20/60 "an eye test is advised", 6 m reported 20/10, and a user
  // with genuine 20/40 vision standing at 6 m was told 20/20 "typical".
  const state = globalThis.window.VisionCheckR.state;
  const at = (distanceValue) => {
    backToIntro();
    completeRun({ distanceValue });
    return { ...state.results.acuity };
  };

  const near = at(1);
  const mid = at(3);
  const far = at(6);

  assert.equal(near.band, far.band,
    `band must not depend on distance: 1 m gave ${near.band}, 6 m gave ${far.band}`);
  assert.equal(near.snellen, far.snellen,
    `snellen must not depend on distance: 1 m gave ${near.snellen}, 6 m gave ${far.snellen}`);
  assert.equal(mid.snellen, far.snellen, '3 m must agree with the others');
  // and the reported value is the line that was actually selected
  assert.equal(near.snellen, near.designSnellen);
});

test('acuity: a line the screen cannot draw at its true size is not offered as a result', () => {
  // The chart clamps every optotype into a drawable range. Clamping DOWN is
  // safe (the letter subtends less than its label claims, so reading it only
  // understates acuity) and the row already carries a "move back" tooltip.
  // Clamping UP is the false-reassurance direction: the row is drawn BIGGER
  // than the acuity printed on its badge, and picking it is reported as that
  // acuity. At 1 m with the default card calibration the bottom three rows all
  // fall under the floor and are painted at the same size, so a user reads
  // 20/25-sized letters and is told 20/10, "typical". A line the screen cannot
  // present honestly must not be selectable.
  backToIntro();
  clickClass('primary'); // intro -> calibrate
  findByAriaLabel('Viewing distance in metres')
    .dispatch('input', { target: { value: '1' } });
  clickClass('primary'); // calibrate -> colour
  for (let i = 0; i < PLATES.length; i++) clickClass('primary'); // -> acuity

  const state = globalThis.window.VisionCheckR.state;
  assert.equal(state.step, 'acuity');
  const ppm = pixelsPerMm(state.calibration.cardWidthPx);
  const rows = findAllByClass('snellen-line');
  assert.equal(rows.length, SNELLEN_LINES.length);

  const lettersIn = (row) => {
    let found = null;
    const visit = (n) => {
      if (found || !n || n.nodeType !== 1) return;
      if (String(n.className).split(/\s+/).includes('letters')) { found = n; return; }
      for (const c of n.children || []) visit(c);
    };
    visit(row);
    return found;
  };

  const selectable = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('aria-disabled') === 'true') continue;
    selectable.push(i);
    const drawnPx = parseFloat(lettersIn(rows[i]).style.fontSize);
    const truePx = snellenLetterHeightPx({
      marArcmin: SNELLEN_LINES[i].marArcmin,
      distanceM: state.calibration.distanceM,
      pixelsPerMm: ppm,
    });
    assert.ok(
      drawnPx <= truePx + 0.01,
      `line ${SNELLEN_LINES[i].snellen} is drawn ${drawnPx}px but subtends only ` +
        `${truePx.toFixed(2)}px at ${state.calibration.distanceM} m: a selectable ` +
        'line must never be enlarged past the acuity its badge claims',
    );
  }
  assert.ok(selectable.length > 0, 'some line must still be selectable');
  assert.ok(selectable.length < rows.length, '1 m must exercise the unpresentable case');
  assert.ok(findByClass('acuity-unavailable'), 'the user is told which lines are missing and why');

  // And the consequence end to end: the bottom row used to be pickable and was
  // scored "20/10, typical" off 6 px letters. It can no longer be chosen, and
  // the finest line the screen really draws scores as itself.
  rows[rows.length - 1].dispatch('click');
  assert.equal(state.acuityLineIndex, undefined, 'an unpresentable line cannot be picked');
  const finest = selectable[selectable.length - 1];
  rows[finest].dispatch('click');
  clickClass('primary'); // finish acuity
  assert.equal(state.results.acuity.snellen, SNELLEN_LINES[finest].snellen);
});
