/**
 * Openings in a curved wall: the void, and the dressed stone around it.
 *
 * The void is produced by **splitting the course**, not by filtering stones out
 * of a full one. `ProceduralCastleWallGenerator` packs the whole span and then
 * drops whatever intersects the opening, which leaves ragged jamb edges whose
 * position depends on how wide the omitted stone happened to be. Packing each
 * surviving sub-interval instead lands stone edges flush on the jamb line —
 * which is what real masonry does, because the jamb *is* the edge.
 */

const ARCH_BLOCK_HEIGHT = 0.27;
const VOUSSOIR_TARGET_WIDTH = 0.28;
const MIN_VOUSSOIRS = 9;
const TRIM_THICKNESS = 0.22;
const FACE_PROUD = 0.075;

/** Half-width of the void at height `y`, following the opening's profile. */
export function openingHalfWidthAt(opening, y) {
  const half = opening.width / 2;
  const sill = opening.sill;
  if (y < sill) return 0;
  const springHeight = springHeightOf(opening);
  const shoulder = sill + springHeight;
  if (y <= shoulder) return half;
  if (opening.profile === 'flat') return y <= sill + opening.height ? half : 0;

  const radius = archRadiusOf(opening);
  const rise = y - shoulder;
  if (opening.profile === 'pointed') {
    // Two arcs struck from the opposite third; the void narrows to a point.
    const crown = sill + opening.height;
    if (y >= crown) return 0;
    return half * (1 - (y - shoulder) / Math.max(1e-6, crown - shoulder));
  }
  if (rise >= radius) return 0;
  return Math.sqrt(Math.max(0, radius * radius - rise * rise)) * (half / radius);
}

function springHeightOf(opening) {
  if (opening.profile === 'flat') return opening.height;
  if (opening.profile === 'segmental') return opening.height * 0.72;
  if (opening.profile === 'pointed') return opening.height * 0.55;
  return Math.max(0, opening.height - opening.width / 2);
}

function archRadiusOf(opening) {
  if (opening.profile === 'segmental') {
    const rise = Math.max(0.05, opening.height - springHeightOf(opening));
    const half = opening.width / 2;
    return (half * half + rise * rise) / (2 * rise);
  }
  return opening.width / 2;
}

/**
 * Subtract the reserved intervals from `[s0, s1]`, leaving the spans a course
 * at height `y` can actually be packed into.
 */
export function survivingIntervals(range, openings, y, { clearance = 0.018 } = {}) {
  const [s0, s1] = range;
  let spans = [[s0, s1]];
  for (const opening of openings) {
    const half = openingHalfWidthAt(opening, y);
    if (half <= 0) continue;
    const low = opening.s - half - clearance;
    const high = opening.s + half + clearance;
    const next = [];
    for (const [from, to] of spans) {
      if (high <= from || low >= to) {
        next.push([from, to]);
        continue;
      }
      if (low > from) next.push([from, Math.min(low, to)]);
      if (high < to) next.push([Math.max(high, from), to]);
    }
    spans = next;
  }
  return spans.filter(([from, to]) => to - from > 1e-6);
}

/**
 * Jambs, voussoirs and a keystone, in arc coordinates.
 *
 * Categories are load-bearing, not cosmetic: `IRREGULARITY_CATEGORY_SCALE`
 * gives `voussoir` 0.3 and `ashlar` 0.45 against field masonry's 1.0, so
 * dressings come out crisp against rough walling. Letting these default to
 * `'field'` makes an arch ring look like rubble (CLAUDE.md).
 */
export function layoutOpening(opening, { thickness, minWidth = 0.2 }) {
  if (!opening.dressed) return { jambs: [], voussoirs: [], keystone: null };
  const half = opening.width / 2;
  const springHeight = springHeightOf(opening);
  const offset = thickness / 2 + FACE_PROUD;
  const jambOffset = half + TRIM_THICKNESS * 0.46;

  const jambs = [];
  const jambCourses = Math.max(1, Math.round(springHeight / ARCH_BLOCK_HEIGHT));
  const jambHeight = springHeight / jambCourses;
  for (const side of [-1, 1]) {
    for (let course = 0; course < jambCourses; course += 1) {
      jambs.push({
        category: 'ashlar',
        s: opening.s + side * jambOffset,
        y: opening.sill + (course + 0.5) * jambHeight,
        offsetNormal: 0,
        width: Math.max(minWidth, TRIM_THICKNESS),
        height: jambHeight * 0.94,
        depth: thickness * 1.04,
        roll: 0,
      });
    }
  }

  const voussoirs = [];
  let keystone = null;
  if (opening.profile !== 'flat') {
    const radius = archRadiusOf(opening) + TRIM_THICKNESS * 0.5;
    const count = Math.max(MIN_VOUSSOIRS, Math.ceil((Math.PI * radius) / VOUSSOIR_TARGET_WIDTH));
    for (let index = 0; index < count; index += 1) {
      const theta = ((index + 0.5) / count) * Math.PI;
      for (const face of [-1, 1]) {
        voussoirs.push({
          category: 'voussoir',
          s: opening.s + Math.cos(theta) * radius,
          y: opening.sill + springHeight + Math.sin(theta) * radius,
          offsetNormal: face * offset,
          width: Math.max(minWidth, VOUSSOIR_TARGET_WIDTH * 0.92),
          height: TRIM_THICKNESS,
          depth: thickness * 0.3,
          // The ring block stands radial to the arc, so its roll is the polar
          // angle less a quarter turn.
          roll: theta - Math.PI / 2,
        });
      }
    }
    keystone = {
      category: 'ashlar',
      s: opening.s,
      y: opening.sill + springHeight + radius,
      offsetNormal: 0,
      width: VOUSSOIR_TARGET_WIDTH * 1.15,
      height: TRIM_THICKNESS * 1.2,
      depth: thickness * 1.06,
      roll: 0,
    };
  } else {
    // A lintel rather than a ring.
    keystone = {
      category: 'ashlar',
      s: opening.s,
      y: opening.sill + opening.height + TRIM_THICKNESS * 0.5,
      offsetNormal: 0,
      width: opening.width + TRIM_THICKNESS * 2,
      height: TRIM_THICKNESS,
      depth: thickness * 1.04,
      roll: 0,
    };
  }

  return { jambs, voussoirs, keystone };
}

/** Total height the opening's dressings reach, for clearance checks. */
export function openingCrownHeight(opening) {
  if (opening.profile === 'flat') return opening.sill + opening.height + TRIM_THICKNESS;
  return opening.sill + springHeightOf(opening) + archRadiusOf(opening) + TRIM_THICKNESS;
}
