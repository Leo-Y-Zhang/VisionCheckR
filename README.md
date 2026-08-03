# VisionCheckR - a privacy-first, offline vision self-check that runs entirely in your browser

[![CI](https://github.com/GreenPandaTech/VisionCheckR/actions/workflows/ci.yml/badge.svg)](https://github.com/GreenPandaTech/VisionCheckR/actions/workflows/ci.yml)
Proprietary - All Rights Reserved - source-available for evaluation only, see [LICENSE](LICENSE).

VisionCheckR runs
four quick screening modules (colour, acuity, astigmatism, contrast) as a single
static page and turns them into plain-language feedback. The non-obvious part is
where it draws the line: all clinical judgement (calibration math, acuity bands,
colour tally, contrast staircase, astigmatism read-out, combined summary) lives in
one pure, deterministic ES module with no DOM and no dependencies, so the scoring
core is fully unit-tested without a browser or a test framework. Nothing you type
ever leaves the tab.

> **Not a medical device. Not a diagnosis.**
> VisionCheckR is an educational screening tool only. It cannot diagnose any
> condition and is **not a substitute for a professional eye exam**. Results are
> affected by your screen, lighting, calibration and viewing distance. For any
> concern about your vision, see a qualified **optometrist or ophthalmologist**.
> If you notice sudden vision changes, pain, flashes, or loss of vision, seek
> medical care promptly.

## What it is

Four self-test modules, then a combined summary:

1. **Colour vision** — Ishihara-style pseudoisochromatic plates generated
   deterministically in code (no image assets) and rendered on a `<canvas>`:
   figure and ground colours sit on the protan/deutan/tritan confusion lines at
   matched luminance. You read the number hidden in the dots (or report seeing
   nothing), and the summary offers an educational tendency read-out.
2. **Visual acuity (distance)** — a Snellen-style chart. You first calibrate the
   screen with a real bank card (85.6 mm) so letters are sized correctly, note
   your viewing distance, then select the smallest line you can read.
3. **Astigmatism fan** — a radiating line "fan"/dial. You report whether any
   directions look darker or sharper than the rest.
4. **Contrast sensitivity** — a Landolt "C" whose contrast fades each trial. You
   pick the direction of the gap; the faintest one you still get sets a threshold.

Every response stays in the browser tab. There are **no accounts, no storage
uploads, no analytics, and no network calls**.

## What's new in v2

v2 deepens the tested scoring core. Every addition is pure, deterministic,
fail-loud, and stays **educational, never diagnostic**:

- **Per-eye asymmetry** — `compareEyes` flags a notable difference between your
  two eyes (worth mentioning to a professional, never a diagnosis).
- **Colour-vision tendency** — `classifyColorTendency` infers an educational
  protan/deutan/tritan *leaning* from type-tagged plates (a tendency, never a
  definitive type).
- **Near (reading) vision** — `nearAcuityScore` screens reading acuity at ~40 cm.
- **Robust adaptive staircase** — `staircaseThreshold` estimates a threshold from
  the reversals of a transformed staircase, lapse-tolerant and deterministic.
- **Reliability assessment** — `assessReliability` judges whether a run is
  trustworthy and marks an unreliable run inconclusive rather than dressing it up.
- **Deterministic session report** — `buildReport` + `reportToJson` /
  `reportToText` produce a portable report (with an injected timestamp) you can
  save or print for an appointment; every rendering embeds the disclaimer.
- **PII-free local save/compare** — `serializeSession` / `deserializeSession` keep
  a run locally with **no identity data**, and `compareSessions` shows a trend.

## What's new in v2.1

v2.1 wires the three lowest-risk v2 core capabilities into the page. All
judgement stays in the tested core — `app.js` only renders and wires events:

- **Download my report** — the summary offers the deterministic core report as a
  text or JSON download, generated on your device via a Blob with the timestamp
  injected at the moment of the click. Nothing is uploaded.
- **PII-free save & compare** — save a run to this browser's localStorage via
  the core's whitelist serializer (module bands, scores and calibration numbers
  only — never names, never free-text input; even the label is generated),
  review saved runs, compare an earlier run with the most recent as an
  educational trend, and delete any or all of them.
- **Run-reliability panel** — `assessReliability` drives an honest verdict on
  the summary: a poorly-calibrated or control-failed run is marked
  inconclusive, with the reasons listed.

## What's new in v2.2

v2.2 activates the colour-vision **tendency** read-out with real, type-tagged
plates — the last colour capability that was waiting on stimuli:

- **Deterministic confusion-line plates** — a new pure module, `plates.mjs`,
  generates the pseudoisochromatic plates entirely in code: no image assets, no
  `Math.random`, no wall clock. Figure and ground chromaticities are computed on
  the CIE protan/deutan/tritan confusion lines through the standard copunctal
  points at matched luminance (tests audit the emitted hex back to CIE xy:
  copunctal-line distance <= 0.0185, figure/ground luminance gap <= 0.0022),
  while the control plate is readable by luminance alone (gap 0.281).
- **Leak-proof geometry** — dot positions and sizes are generated digit-blind
  (a pure function of the seed and dot budget; the digit only ever selects
  colours), so no size filter, density difference or contour gap can betray
  the digit to someone who cannot see the colour difference. Two plates with
  the same seed have identical dot layouts whatever their digits — a tested
  invariant.
- **Tendency on the summary** — the canonical 8-plate set (1 luminance control,
  2 protan / 3 deutan / 2 tritan) feeds `classifyColorTendency`; the summary
  shows the leaning with its confidence and per-type miss breakdown, stays
  honestly inconclusive when the control is missed, and remains a tendency,
  never a diagnosis.
- **Persistence unchanged and pinned** — only the tendency and confidence
  strings survive the PII-free whitelist serializer; new tests pin exactly
  that.

## Quickstart

The app is a static site — no build step, no server, nothing to install.

```bash
git clone https://github.com/GreenPandaTech/VisionCheckR.git
cd VisionCheckR
```

Then open `index.html` in any modern browser (double-click, or `File > Open`).
That is the whole app.

To run the automated tests you need **Node.js v18+** (the built-in test runner has
no separate install):

```bash
npm test          # alias for: node --test
```

Expected output:

```
ℹ tests 159
ℹ pass 159
ℹ fail 0
```

Optionally serve the static files over HTTP (Python standard library only, no pip
installs):

```bash
python -m http.server 8000
# then visit http://localhost:8000/
```

## Architecture

```
VisionCheckR/
  index.html              # app shell + prominent disclaimers
  styles.css              # accessible, responsive styling (no external assets)
  app.js                  # UI controller: canvas modules wired to the core
  scoring.mjs             # pure, tested scoring core (no DOM, no deps)
  plates.mjs              # pure, deterministic confusion-line plate generator
  test/                   # 14 suites, 159 tests, Node built-in runner
    scoring.test.mjs      # unit tests for the v1 scoring functions
    ...                   # one focused suite per v2 capability
    app.smoke.test.mjs    # headless end-to-end run of app.js via a DOM stub
```

`scoring.mjs` holds every decision — acuity from smallest line + distance, colour
pass/fail tally, contrast threshold, astigmatism interpretation, and the combined
summary — as pure, deterministic, side-effect-free functions. `app.js` only handles
DOM/canvas rendering and input, delegating every judgement to the core. That split
is what lets the core be unit-tested with no browser and no third-party library.

## Tests

The suite runs on the **Node built-in test runner** — no dependencies, no config:

```bash
npm test          # node --test
```

The current suite is **159 tests, all passing**:

- The `test/*.test.mjs` files cover the v1 core (calibration math, acuity scoring
  and bands, optotype geometry, the colour tally with control-plate reliability,
  astigmatism, the contrast staircase, the combined summary) and the v2 additions
  (per-eye asymmetry, colour-vision tendency, near acuity, the adaptive-staircase
  estimator, reliability assessment, the deterministic report, and PII-free
  save/compare), plus a golden-digest determinism tripwire and a hostile-input
  sweep that asserts every public function fails loud.
- `test/app.smoke.test.mjs` imports the real `app.js` against a small hand-rolled
  DOM/canvas stub and clicks through **all four modules end-to-end**, asserting
  each records a result and that the summary renders with its disclaimer. It
  also clicks through the v2.1 UI wiring: both report downloads (reading back
  the exact bytes handed to the Blob and asserting the MIME type, headline,
  embedded disclaimer and injected timestamp — the JSON download must parse
  with its schema tag), the save -> reload -> compare -> delete flow against a
  localStorage stub, and the reliability panel in each verdict class.
- `test/plates.test.mjs` audits the generated plates from their emitted output:
  determinism, colour science (chromaticities recovered from the emitted sRGB
  hex must lie on the right confusion line at matched luminance), the
  digit-blind-geometry anti-leak invariants, structural legibility of every
  stroke cell of the shipped set, and fail-loud validation.

CI runs the same `npm test` on every push and pull request
(`.github/workflows/ci.yml`).

## Safety and privacy

- **Educational screening only — never a diagnosis.** Disclaimers appear on the
  page header, on the summary, and in this README by design.
- **See a professional.** The summary always recommends a professional eye exam,
  and does so more urgently whenever any module is flagged.
- **Local-only.** No accounts, no cookies, no analytics, no network requests. Your
  responses never leave the browser tab. (The optional `python -m http.server` only
  serves the static files; it never receives your answers.)
- **Saved results are PII-free and deletable.** Saving is optional, lives only in
  this browser's localStorage, and contains only module bands, scores and
  calibration numbers — never names or free-text input. The app provides per-run
  delete and delete-all controls.

## Limitations and scope

- The colour plates are an **approximation for education**, not a certified
  Ishihara set. The tendency read-out suggests a protan/deutan/tritan *leaning*
  only — on an uncalibrated consumer screen it can never classify a deficiency;
  a professional colour-vision test is needed for that.
- On-screen acuity and contrast depend entirely on **correct card calibration and a
  correctly measured viewing distance** — the numbers are only as good as those
  inputs.
- Testing is **binocular** (both eyes at once); there is no per-eye separation.
- Rendering varies with display, brightness, colour profile and ambient light, so
  results are indicative, not clinical measurements.

## Roadmap

**Delivered in v2** (in the scoring core): per-eye asymmetry, a colour-vision
tendency read-out, near (reading) acuity, a robust adaptive-staircase estimator, a
reliability assessment, a deterministic saveable session report, and PII-free local
save/compare.

**Delivered in v2.1** (in the UI): report download (text and JSON), local PII-free
save/compare with a trend view, and the run-reliability panel.

**Delivered in v2.2**: deterministic in-code confusion-line plates (`plates.mjs`)
and the colour-vision tendency read-out on the summary.

**Next**
- Wire the remaining v2 core capabilities into the UI (per-eye prompts, near-vision
  testing, the adaptive staircase for the live contrast module).
- A more rigorous, validated colour-plate set and a dedicated near-vision chart.
- Full keyboard-only walkthrough audit, screen-reader pass, and localisation.

**V3**
- Adaptive staircases (e.g. QUEST-style) for acuity and contrast to converge on a
  threshold faster and more reliably.
- Optional webcam-assisted distance estimation (fully on-device, opt-in) to reduce
  distance-measurement error — with a clear privacy explanation and no upload.
- Amsler grid (macular) and simple peripheral-awareness checks.
- Guidance content that maps flagged results to what a professional exam involves.

## License

Proprietary - All Rights Reserved. This project is source-available for
evaluation only: you may read the code and run it locally (including its test
suite) to assess it; no reuse, redistribution or derivative rights are granted.
See [LICENSE](LICENSE) for the full terms.
