// plates.mjs
// VisionCheckR — deterministic pseudoisochromatic (confusion-line) colour
// plate generation. PURE and dependency-free: no DOM, no canvas, no image
// assets, no wall clock and no Math.random — the only entropy is the injected
// integer seed, so identical inputs always produce identical plates. app.js
// merely paints the precomputed dots; every judgement about the responses
// stays in scoring.mjs (tallyColorTest / classifyColorTendency).
//
// HOW THE PLATES WORK (and their honest limits):
// A dichromat confuses colours that lie on a "confusion line" through the
// copunctal point of the missing cone type in CIE 1931 xy chromaticity space.
// Each plate therefore renders its hidden digit in a figure colour and its
// surround in a ground colour chosen ON the confusion line of the type the
// plate probes, at MATCHED luminance (with the same per-dot luminance jitter
// applied to both roles, so brightness carries no cue). Typical colour vision
// sees the chromatic difference and reads the digit; the probed deficiency
// type tends not to. This is an EDUCATIONAL APPROXIMATION rendered on an
// uncalibrated consumer screen — it is not a certified Ishihara/HRR set, and
// nothing derived from it is a diagnosis.
//
// ANTI-LEAK DESIGN (geometry is digit-blind): the digit must be encoded ONLY
// chromatically, so the dot GEOMETRY (positions and radii) is generated first
// as a pure function of (seed, dotCount) — the answer and kind are never
// consulted — and each dot's figure/ground role is then decided by its centre
// alone. Consequently no size filter, density difference or contour-hugging
// gap can reconstruct the digit from the geometry: two plates with the same
// seed and dotCount have IDENTICAL dot layouts whatever their digits (tested).
// An earlier design used oversized figure-only anchor dots plus a dot-free
// margin along the contour; an adversarial review showed both leaked the digit
// to luminance-only viewing, which is exactly the population these plates
// probe. Do not reintroduce digit-dependent geometry.

/** The kinds of plate the generator can produce. */
export const PLATE_KINDS = Object.freeze(['control', 'protan', 'deutan', 'tritan']);

const CONFUSION_TYPES = Object.freeze(['protan', 'deutan', 'tritan']);

/**
 * CIE 1931 xy copunctal points: all confusion lines of a dichromat type pass
 * through its copunctal point (Wyszecki & Stiles convention).
 */
export const COPUNCTAL_POINTS = Object.freeze({
  protan: Object.freeze({ x: 0.7465, y: 0.2535 }),
  deutan: Object.freeze({ x: 1.4, y: -0.4 }),
  tritan: Object.freeze({ x: 0.1748, y: 0.0044 }),
});

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — integer arithmetic only, so the stream is
// bit-identical on every platform and engine.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Colour: CIE xyY <-> sRGB (D65). Fail-loud on out-of-gamut requests so a bad
// palette edit breaks tests instead of silently clamping to a wrong colour.
// ---------------------------------------------------------------------------

function gammaEncode(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** sRGB EOTF: code value in [0,1] -> relative luminance. Exported because the
 *  contrast module needs it too - Michelson on gamma-encoded code values is not
 *  a contrast, and computing it on them overstated sensitivity by 2.16x. */
export function gammaDecode(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Convert a CIE xyY colour to an sRGB hex string. Throws when out of gamut. */
export function xyYToSrgbHex({ x, y, Y } = {}) {
  for (const [name, v] of [['x', x], ['y', y], ['Y', Y]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`xyYToSrgbHex: ${name} must be a finite number, got: ${v}`);
    }
  }
  if (y <= 0) throw new RangeError('xyYToSrgbHex: y must be positive');
  const X = (x * Y) / y;
  const Z = ((1 - x - y) * Y) / y;
  const linear = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
  let hex = '#';
  for (const c of linear) {
    if (c < -1e-4 || c > 1 + 1e-4) {
      throw new RangeError(`xyYToSrgbHex: xyY(${x}, ${y}, ${Y}) is outside the sRGB gamut`);
    }
    const clamped = Math.min(1, Math.max(0, c));
    hex += Math.round(gammaEncode(clamped) * 255).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Convert an sRGB hex string back to CIE xyY (used by tests to audit output). */
export function srgbHexToXyy(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new TypeError(`srgbHexToXyy: expected a #rrggbb string, got: ${hex}`);
  }
  const [R, G, B] = [1, 3, 5].map((i) => gammaDecode(parseInt(hex.slice(i, i + 2), 16) / 255));
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.329, Y: 0 }; // black: report the D65 white chromaticity
  return { x: X / sum, y: Y / sum, Y };
}

// ---------------------------------------------------------------------------
// Palettes. For a confusion type the figure/ground chromaticities are the base
// point stepped +/- d along the unit direction toward that type's copunctal
// point, which puts BOTH endpoints exactly on one confusion line. Both roles
// share the same luminance-jitter levels, so luminance carries no signal. The
// control plate inverts the trick: near-identical chromaticity but a large
// luminance gap, so everyone (including a dichromat) can read it.
// ---------------------------------------------------------------------------

const CONFUSION_BASES = Object.freeze({
  protan: { x: 0.35, y: 0.33, d: 0.055 },
  deutan: { x: 0.34, y: 0.33, d: 0.055 },
  tritan: { x: 0.33, y: 0.33, d: 0.05 },
});

const CONFUSION_Y_LEVELS = Object.freeze([0.3, 0.34, 0.38, 0.42]);
const CONTROL_CHROMA = Object.freeze({ x: 0.345, y: 0.352 });
const CONTROL_FIGURE_Y_LEVELS = Object.freeze([0.055, 0.07, 0.085, 0.1]);
const CONTROL_GROUND_Y_LEVELS = Object.freeze([0.38, 0.44, 0.5, 0.56]);

function requireKind(kind) {
  if (!PLATE_KINDS.includes(kind)) {
    throw new RangeError(`plate kind must be one of ${PLATE_KINDS.join(', ')}, got: ${kind}`);
  }
}

/**
 * The figure/ground colour ramps (sRGB hex) for a plate kind. Ramp index i of
 * both roles shares the same luminance level.
 */
export function platePalette(kind) {
  requireKind(kind);
  if (kind === 'control') {
    return {
      figure: CONTROL_FIGURE_Y_LEVELS.map((Y) => xyYToSrgbHex({ ...CONTROL_CHROMA, Y })),
      ground: CONTROL_GROUND_Y_LEVELS.map((Y) => xyYToSrgbHex({ ...CONTROL_CHROMA, Y })),
    };
  }
  const base = CONFUSION_BASES[kind];
  const copunctal = COPUNCTAL_POINTS[kind];
  const dx = copunctal.x - base.x;
  const dy = copunctal.y - base.y;
  const norm = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / norm;
  const uy = dy / norm;
  const figureChroma = { x: base.x + base.d * ux, y: base.y + base.d * uy };
  const groundChroma = { x: base.x - base.d * ux, y: base.y - base.d * uy };
  return {
    figure: CONFUSION_Y_LEVELS.map((Y) => xyYToSrgbHex({ ...figureChroma, Y })),
    ground: CONFUSION_Y_LEVELS.map((Y) => xyYToSrgbHex({ ...groundChroma, Y })),
  };
}

/** Warm paper background behind the dots (same deterministic colour pipeline). */
const PLATE_BACKGROUND = xyYToSrgbHex({ x: 0.345, y: 0.358, Y: 0.72 });

// ---------------------------------------------------------------------------
// Digit geometry: a 5x7 bitmap glyph per digit, laid out in the unit square
// (the plate disc is centred at 0.5,0.5 with radius 0.48). Pure geometry — no
// canvas text, no font dependency, fully deterministic.
// ---------------------------------------------------------------------------

const DIGIT_GLYPHS = Object.freeze({
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
});

const GLYPH_ROWS = 7;
const GLYPH_COLS = 5;
const DIGIT_GAP_COLS = 1; // blank column between two digits

function requireAnswer(answer) {
  if (typeof answer !== 'string') {
    throw new TypeError(`answer must be a string of digits, got: ${answer}`);
  }
  if (!/^[0-9]{1,2}$/.test(answer)) {
    throw new RangeError(`answer must be 1 or 2 digits, got: ${answer}`);
  }
}

// Cell size and block origin so the digit block fits comfortably in the disc.
function digitLayout(answer) {
  const cols = answer.length * GLYPH_COLS + (answer.length - 1) * DIGIT_GAP_COLS;
  const cell = Math.min(0.6 / GLYPH_ROWS, 0.68 / cols);
  return {
    cols,
    cell,
    left: 0.5 - (cols * cell) / 2,
    top: 0.5 - (GLYPH_ROWS * cell) / 2,
  };
}

/**
 * Whether a unit-square point falls inside the digit mask for `answer`.
 * Exported so tests can audit the figure/ground role of every dot.
 */
export function isInDigit(answer, x, y) {
  requireAnswer(answer);
  const { cols, cell, left, top } = digitLayout(answer);
  const col = Math.floor((x - left) / cell);
  const row = Math.floor((y - top) / cell);
  if (col < 0 || col >= cols || row < 0 || row >= GLYPH_ROWS) return false;
  const digitIndex = Math.floor(col / (GLYPH_COLS + DIGIT_GAP_COLS));
  const inCol = col - digitIndex * (GLYPH_COLS + DIGIT_GAP_COLS);
  if (inCol >= GLYPH_COLS) return false; // gap column between digits
  return DIGIT_GLYPHS[answer[digitIndex]][row][inCol] === '#';
}

function* onCells(answer) {
  const { cell, left, top } = digitLayout(answer);
  for (let di = 0; di < answer.length; di++) {
    const glyph = DIGIT_GLYPHS[answer[di]];
    for (let row = 0; row < GLYPH_ROWS; row++) {
      for (let col = 0; col < GLYPH_COLS; col++) {
        if (glyph[row][col] === '#') {
          yield {
            x: left + (di * (GLYPH_COLS + DIGIT_GAP_COLS) + col + 0.5) * cell,
            y: top + (row + 0.5) * cell,
            cell,
          };
        }
      }
    }
  }
}

/**
 * The '#' (stroke) cells of the digit mask for `answer`, as unit-square
 * squares { left, top, size }. Exported so tests can audit that every stroke
 * cell of the shipped plates actually receives figure dots.
 */
export function digitCells(answer) {
  requireAnswer(answer);
  return [...onCells(answer)].map(({ x, y, cell }) => ({
    left: round4(x - cell / 2),
    top: round4(y - cell / 2),
    size: round4(cell),
  }));
}

// ---------------------------------------------------------------------------
// Plate generation
// ---------------------------------------------------------------------------

const DISC_RADIUS = 0.48;
const DOT_R_MIN = 0.007;
const DOT_R_RANGE = 0.009; // radii span [0.007, 0.016] of the plate width

function pick(rng, ramp) {
  return ramp[Math.floor(rng() * ramp.length)];
}

/**
 * Generate one deterministic plate. Coordinates and radii are fractions of the
 * plate size (unit square, disc centred at 0.5,0.5), so the renderer only has
 * to scale by its canvas size.
 *
 * @param {object} p
 * @param {'control'|'protan'|'deutan'|'tritan'} p.kind
 * @param {string} p.answer   The hidden digits ('0'..'99' as a 1-2 digit string).
 * @param {number} p.seed     Non-negative integer; the ONLY source of variation.
 * @param {number} [p.dotCount=900] Approximate dot budget: the jittered
 *   lattice snaps to the nearest whole resolution, so the emitted count is
 *   close to (not exactly) this number. At the default budget the lattice
 *   pitch is at most half a glyph cell, which structurally guarantees every
 *   stroke cell receives figure dots for EVERY seed; far smaller budgets give
 *   sparse (but still valid and still leak-free) plates.
 * @returns {object} { kind, answer, seed, background, dots, control? | probes? }
 */
export function generatePlate({ kind, answer, seed, dotCount = 900 } = {}) {
  requireKind(kind);
  requireAnswer(answer);
  if (typeof seed !== 'number' || Number.isNaN(seed)) {
    throw new TypeError(`seed must be a number, got: ${seed}`);
  }
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError(`seed must be a non-negative integer, got: ${seed}`);
  }
  if (!Number.isInteger(dotCount) || dotCount < 50 || dotCount > 5000) {
    throw new RangeError(`dotCount must be an integer in [50, 5000], got: ${dotCount}`);
  }

  const palette = platePalette(kind);
  const rng = mulberry32(seed);

  // 1) Geometry FIRST, digit-blind. A jittered square lattice fills the disc:
  //    one dot per lattice cell, jittered by up to 0.45 pitch (so each centre
  //    stays inside its own cell) with a radius drawn from one shared range.
  //    Positions and radii depend ONLY on (seed, dotCount) — never on the
  //    answer or kind — so the geometry carries zero digit information: no
  //    figure/ground size difference, no density difference, no dot-free
  //    margin along the contour. Uniform lattice coverage also guarantees
  //    legibility structurally: at the default budget every glyph stroke cell
  //    wholly contains at least one lattice cell, hence at least one dot,
  //    for every seed. Dots at the rim of the disc are dropped whole.
  const lattice = Math.max(4, Math.round(Math.sqrt(dotCount / (Math.PI * DISC_RADIUS * DISC_RADIUS))));
  const pitch = 1 / lattice;
  const geometry = [];
  for (let gy = 0; gy < lattice; gy++) {
    for (let gx = 0; gx < lattice; gx++) {
      const x = round4((gx + 0.5 + (rng() - 0.5) * 0.9) * pitch);
      const y = round4((gy + 0.5 + (rng() - 0.5) * 0.9) * pitch);
      const r = round4(DOT_R_MIN + rng() * DOT_R_RANGE);
      const dx = x - 0.5;
      const dy = y - 0.5;
      if (Math.sqrt(dx * dx + dy * dy) > DISC_RADIUS - r) continue; // off the plate rim
      geometry.push({ x, y, r });
    }
  }

  // 2) Colour SECOND. Each dot's figure/ground role is decided by its CENTRE
  //    alone, so the role data stays exactly consistent with the emitted
  //    geometry; a dot near the contour may visually overlap it, exactly as
  //    the round dots of a printed plate weave across a curved stroke edge.
  //    Every dot consumes exactly one rng draw for its colour and all ramps
  //    share one length, so plates with the same seed and dotCount stay
  //    IDENTICAL in geometry across answers and kinds (tested invariant).
  const dots = geometry.map(({ x, y, r }) => {
    const inside = isInDigit(answer, x, y);
    const role = inside ? 'figure' : 'ground';
    return { x, y, r, role, color: pick(rng, palette[role]) };
  });

  const plate = { kind, answer, seed, background: PLATE_BACKGROUND, dots };
  if (kind === 'control') plate.control = true;
  else plate.probes = kind;
  return plate;
}

// ---------------------------------------------------------------------------
// The canonical plate set the app uses. Fixed seeds -> the same plates every
// session (a screening aid should not shuffle its stimuli between runs).
// One control everyone should read, then 2 protan / 3 deutan / 2 tritan
// (deutan gets the extra plate as the most common deficiency), interleaved so
// consecutive plates probe different types.
// ---------------------------------------------------------------------------

const PLATE_SET_SPEC = Object.freeze([
  { kind: 'control', answer: '12', seed: 101 },
  { kind: 'protan', answer: '74', seed: 102 },
  { kind: 'deutan', answer: '8', seed: 103 },
  { kind: 'tritan', answer: '15', seed: 104 },
  { kind: 'deutan', answer: '29', seed: 105 },
  { kind: 'protan', answer: '6', seed: 106 },
  { kind: 'tritan', answer: '3', seed: 107 },
  { kind: 'deutan', answer: '5', seed: 108 },
]);

/** Build the canonical 8-plate set (deterministic; safe to call repeatedly). */
export function buildConfusionPlateSet() {
  return PLATE_SET_SPEC.map((spec) => generatePlate(spec));
}
