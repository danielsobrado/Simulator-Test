import { beamBetween } from './HouseFacade.js';

/**
 * Carpentry under a village roof's edges, so a roof reads as built timber and
 * not a lid: a deep fascia board along each eaves, barge boards up each verge,
 * rafter tails in the soffit and purlin ends standing out of each gable.
 *
 * Every member hangs below the deck (`deck` thick) so none shows through the
 * tiles. Sizes are jittered per member from the kit's stream: a row of
 * identical sticks would read as the straight lines this is meant to break.
 */
const RAFTER_SPACING = 0.62;
const RAFTER_SIZE = 0.11;
const RAFTER_DEPTH = 0.15;
const FASCIA_HEIGHT = 0.22;
const FASCIA_THICKNESS = 0.06;

function lowered(point, drop) {
  return [point[0], point[1] - drop, point[2]];
}

function slopeDrop(a, b, deck, size) {
  const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const cos = run / Math.max(1e-6, Math.hypot(run, b[1] - a[1]));
  return deck + size / 2 / Math.max(0.3, cos);
}

/** Fascia along the eaves edge and rafter tails from the wall line out to it. */
function eavesTrim(kit, face, surface, deck) {
  const span = face.span(1);
  const segments = Math.max(2, Math.ceil(span / 1.6));
  for (let index = 0; index < segments; index += 1) {
    const a = face.point(index / segments, 1);
    const b = face.point((index + 1) / segments, 1);
    const sag = (kit.random() - 0.5) * 0.025;
    kit.add('wood', beamBetween(
      lowered(a, deck + FASCIA_HEIGHT / 2 - 0.02 + sag),
      lowered(b, deck + FASCIA_HEIGHT / 2 - 0.02 - sag),
      FASCIA_THICKNESS,
      { depth: FASCIA_HEIGHT, side: face.outward },
    ));
  }
  const inner = Math.max(0, surface.wallRatio - 0.03);
  const count = Math.max(2, Math.round(span / RAFTER_SPACING));
  for (let index = 1; index < count; index += 1) {
    const s = (index + (kit.random() - 0.5) * 0.18) / count;
    const from = face.point(s, inner);
    const to = face.point(s, 0.985);
    const size = RAFTER_SIZE * (0.85 + kit.random() * 0.3);
    const drop = slopeDrop(from, to, deck, RAFTER_DEPTH);
    kit.add('wood', beamBetween(lowered(from, drop), lowered(to, drop), size, { depth: RAFTER_DEPTH, side: face.alongOutward }));
  }
}

/** Barge boards up both verges of a gabled side face. */
function vergeTrim(kit, face, deck) {
  const steps = 6;
  for (const s of [0, 1]) {
    for (let step = 0; step < steps; step += 1) {
      const a = face.point(s, step / steps);
      const b = face.point(s, (step + 1) / steps);
      const drop = slopeDrop(a, b, deck, FASCIA_HEIGHT) - 0.03;
      kit.add('wood', beamBetween(lowered(a, drop), lowered(b, drop), FASCIA_THICKNESS, {
        depth: FASCIA_HEIGHT,
        side: face.alongOutward.map((value) => value * (s === 0 ? -1 : 1)),
      }));
    }
  }
}

/** Ridge and side purlins: log ends out of the gable, under the verge. */
function purlinEnds(kit, surface, end, deck) {
  for (const c of [0, -0.5, 0.5]) {
    const r = Math.abs(c) * surface.wallRatio;
    const size = (c === 0 ? 0.24 : 0.19) * (0.9 + kit.random() * 0.2);
    const y = surface.height(r, end * surface.halfSpan) - deck - size * 0.62;
    const across = c * surface.eaves * surface.wallRatio;
    const wall = surface.toWorld(end * (surface.halfSpan - 0.15), y, across);
    const tip = surface.toWorld(end * (surface.halfLength - 0.06 - kit.random() * 0.05), y, across);
    kit.add('wood', beamBetween(wall, tip, size, { depth: size }));
  }
}

/**
 * @param {import('./HouseKit.js').HouseKit} kit
 * @param {object} surface createRoofSurface result
 * @param {object[]} faces roof faces (side faces get eaves trim; hips only fascia)
 * @param {{ gabled: boolean, gableEnds: object, deck: number }} options
 */
export function addRoofTrim(kit, surface, faces, { gabled, gableEnds, deck }) {
  for (const face of faces) {
    if (face.kind === 'side') {
      eavesTrim(kit, face, surface, deck);
      if (gabled) vergeTrim(kit, face, deck);
    }
  }
  if (!gabled) return;
  for (const [key, end] of [['start', -1], ['end', 1]]) {
    if (gableEnds[key]) purlinEnds(kit, surface, end, deck);
  }
}
