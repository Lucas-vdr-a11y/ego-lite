// Shared by the rendered fixture and by the visual-path e2e case. That case
// locates every target from screenshot pixels alone, so both sides have to agree
// on the exact swatch colours.
//
// The colours are near-gray on purpose. Display colour management leaves R=G=B
// (and values within a step or two of it) byte-identical in a screenshot, while
// saturated colours drift far: rgb(255,0,0) reads back as rgb(233,46,32) on a P3
// display. The -1 on the blue channel keeps each swatch distinct from the pure
// grays that text antialiasing scatters across the page.

export function swatchColor(value) {
  return `rgb(${value}, ${value}, ${value - 1})`;
}

export function swatchRgb(value) {
  return [value, value, value - 1];
}

// width/height are CSS pixels, gap is the margin before the swatch. Sizes and
// gaps are deliberately uneven: coordinate error surfaces on the small ones
// first, and a regular grid would let a wrong-but-consistent offset still land.
export const PRIMARY_TARGETS = [
  {
    id: "alpha",
    label: "Alpha",
    width: 208,
    height: 68,
    gap: 0,
    pending: 214,
    done: 34,
  },
  {
    id: "bravo",
    label: "Bravo",
    width: 118,
    height: 48,
    gap: 18,
    pending: 210,
    done: 38,
  },
  {
    id: "charlie",
    label: "Charlie",
    width: 74,
    height: 34,
    gap: 92,
    pending: 206,
    done: 42,
  },
  {
    id: "delta",
    label: "Delta",
    width: 44,
    height: 24,
    gap: 34,
    pending: 202,
    done: 46,
  },
];

export const PRECISION_CHIPS = [
  { id: "chip-1", edge: 40, gap: 0, pending: 198, done: 50 },
  { id: "chip-2", edge: 26, gap: 14, pending: 194, done: 54 },
  { id: "chip-3", edge: 8, gap: 56, pending: 190, done: 58 },
  { id: "chip-4", edge: 32, gap: 10, pending: 186, done: 62 },
  { id: "chip-5", edge: 12, gap: 30, pending: 182, done: 66 },
  { id: "chip-6", edge: 20, gap: 64, pending: 178, done: 70 },
  { id: "chip-7", edge: 10, gap: 18, pending: 174, done: 74 },
  { id: "chip-8", edge: 16, gap: 40, pending: 170, done: 78 },
].map((chip) => ({
  ...chip,
  label: chip.id.replace("chip-", "Chip "),
  width: chip.edge,
  height: chip.edge,
}));

export const ALL_TARGETS = [...PRIMARY_TARGETS, ...PRECISION_CHIPS];

// Ink the canvas draws with, and the canvas surface it draws on.
export const CANVAS_INK = 60;
export const CANVAS_PAPER = 252;
export const CANVAS_WIDTH = 620;
export const CANVAS_HEIGHT = 240;

export function targetById(id) {
  return ALL_TARGETS.find((target) => target.id === id);
}
