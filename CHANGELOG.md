# Changelog

All notable changes to VisionCheckR are documented here. VisionCheckR is an **educational
vision self-check**, never a diagnosis or a medical device — see the disclaimer in
the app and `README.md`.

The format follows [Keep a Changelog](https://keepachangelog.com/); this project
uses [Semantic Versioning](https://semver.org/).

## [2.2.0] - 2026-07-31

Activates the colour-vision tendency read-out (`classifyColorTendency`, in the
core since v2.0.0) with real, deterministic, type-tagged plates. All judgement
stays in the tested pure core; `app.js` only paints precomputed dots and wires
responses. Zero runtime dependencies preserved; local-only, educational and
non-diagnostic as ever.

### Added

- **`plates.mjs`** — a pure, dependency-free pseudoisochromatic plate
  generator: no DOM, no canvas, no image assets, no wall clock, no
  `Math.random`; the only entropy is the injected integer seed, so identical
  inputs yield byte-identical plates. Figure and ground chromaticities are
  computed on the CIE 1931 protan/deutan/tritan confusion lines through the
  standard copunctal points at matched luminance, converted xyY -> sRGB with
  fail-loud gamut checks. Tests audit the EMITTED hex back to CIE xy: the
  figure-ground line passes within 0.0185 of the copunctal point, matched
  luminance holds to |dY| <= 0.0022, and the control plate carries a 0.281
  luminance gap so everyone (including a dichromat) can read it.
- **Digit-blind geometry (anti-leak design)** — dot positions and radii are a
  pure function of (seed, dot budget); the digit only ever selects colours, so
  the geometry carries zero digit information: no figure/ground size
  difference, no density difference, no dot-free margin along the contour.
  An adversarial review of the first in-development design showed the digit
  could be reconstructed from geometry alone (oversized figure-only anchor
  dots and a contour margin) — a false-negative trap for exactly the
  colour-deficient users the plates probe. The redesign eliminates the class:
  re-running the review's attacks, the best dot-size filter now recovers the
  figure at 19.9% precision vs an 18.1% chance rate (was 100%), and mean
  contour clearance is 0.78x the random baseline (was 3.5x). Same-seed plates
  have identical dot layouts whatever their digits — a tested invariant.
- **Structural legibility** — the jittered-lattice layout guarantees every
  digit stroke cell receives figure dots for every seed at the default dot
  budget (841-852 dots per shipped plate); a test asserts at least 2 figure
  dots per stroke cell across the whole shipped set. Rendering was also
  verified visually in headless Chromium: all 8 digits legible in colour, and
  the 7 confusion plates are pure noise in a grayscale (luminance-only)
  render while the control stays readable.
- **Tendency on the summary** — the canonical 8-plate set (1 luminance
  control, then 2 protan / 3 deutan / 2 tritan, interleaved, fixed seeds)
  feeds both `tallyColorTest` and `classifyColorTendency`; the summary shows
  the leaning with confidence and a per-type miss breakdown, stays honestly
  inconclusive when the control is missed (which also degrades run
  reliability to partial), and frames everything as a tendency, never a
  diagnosis.
- Tests: 19 plate tests (incl. the colour-science audits and the anti-leak
  invariants), 4 app smoke tests driving the full DOM flow, and 1 persistence
  test pinning that only the tendency and confidence strings survive the
  PII-free whitelist serializer.

### Changed

- The colour module now renders the deterministic confusion-line plates; the
  response flow and scoring semantics are unchanged.
- README: v2.2 section, updated colour-module description, limitations
  honestly reworded (the tendency is a leaning, never a classification),
  test counts refreshed.

## [2.1.0] - 2026-07-30

Wires three v2.0 core capabilities into the UI. All judgement stays in the
tested pure core; `app.js` only renders and wires events. Zero runtime
dependencies preserved; everything remains local-only, educational and
non-diagnostic.

### Added

- **Report download**: the summary offers "Download my report" as text and as
  JSON, rendered by `buildReport` + `reportToText` / `reportToJson` and
  delivered via an on-device Blob. The timestamp is injected at the moment of
  the click so the core stays deterministic; every download embeds the
  disclaimer and nothing is uploaded.
- **PII-free save & compare**: save a run to this browser's localStorage through
  the core's whitelist `serializeSession` (module bands, scores and calibration
  numbers only — never names, never free-text input; even the label is
  generated), a saved-results view, an educational trend between an earlier run
  and the most recent via `compareSessions`, per-run delete and delete-all
  controls, and a visible note that no identity data is stored.
- **Run-reliability panel**: `assessReliability` now drives an honest verdict on
  the summary — a poorly-calibrated or control-failed run is marked
  inconclusive, with its reasons listed.
- Smoke coverage: the DOM-stub test now clicks through the downloads (reading
  back the exact bytes handed to the Blob and asserting their type, headline,
  disclaimer and injected timestamp; the JSON must parse with its schema tag),
  the save -> reload -> compare -> delete flow against a localStorage stub, and
  the reliability panel in each verdict class (125 -> 132 tests).

### Changed

- README: corrected the stale test count and documented the v2.1 UI wiring.
- CI: leaned from the Node 18/20/22 matrix to a single validated version (22)
  with concurrency cancel-in-progress, to keep CI runs lean. The suite itself
  still targets Node 18+ (the matrix ran green on all three before the change).

## [2.0.0] - 2026-07-12

A large, fully additive expansion of the pure, dependency-free scoring core
(`scoring.mjs`). The v1 scoring API and the app behaviour are unchanged; every
addition is pure, deterministic, fail-loud on bad input, and stays educational and
non-diagnostic. Zero runtime dependencies preserved.

### Added

- **Per-eye asymmetry** (`compareEyes`, `labelEye`): flag a notable interocular
  difference in acuity (logMAR) or contrast (logCS) — worth mentioning to a
  professional, never a diagnosis; folded into `summarize`.
- **Colour-vision tendency** (`classifyColorTendency`): infer an educational
  protan/deutan/tritan *leaning* from the miss pattern across type-tagged plates.
  A tendency, never a definitive type; control failure or no tagged plates is
  inconclusive. `tallyColorTest` is unchanged.
- **Near (reading) acuity** (`nearAcuityScore`): reading-vision screening at ~40 cm
  with an approximate N-notation, sharing a MAR helper with distance acuity
  (`acuityScore`'s output is byte-identical).
- **Robust adaptive staircase** (`staircaseThreshold`): estimate a threshold from
  the reversals of a completed transformed-staircase run — deterministic,
  lapse-tolerant (only the last N reversals count), inconclusive when there are too
  few reversals.
- **Reliability assessment** (`assessReliability`): judge whether a whole run is
  trustworthy (calibration sanity, colour control, inconclusive modules) and mark
  an unreliable run inconclusive rather than dressing it up.
- **Deterministic session report** (`buildReport`, `reportToJson`, `reportToText`):
  a portable report with an injected timestamp (no wall-clock), byte-identical for
  identical inputs, embedding the disclaimer in every rendering.
- **PII-free local save/compare** (`serializeSession`, `deserializeSession`,
  `compareSessions`): store a run locally with no identity data (a whitelist of
  band/score fields only) and show an educational trend across runs.
- **Tooling & guarantees**: a CI Node matrix (18/20/22), a golden-digest determinism
  tripwire, and a central hostile-input sweep asserting every public function fails
  loud. A `VERSION` export kept in lockstep with `package.json`.

## [1.0.0] - 2026-07-01

- Initial release: four self-test modules (colour, distance acuity, astigmatism,
  contrast) as a single static page, with all clinical judgement in one pure,
  deterministic, dependency-free scoring module unit-tested with the Node built-in
  test runner. Local-only, no network, no storage uploads.
