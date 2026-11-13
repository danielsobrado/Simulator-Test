import { addFacadeColumn, facadeBeam, facadePeg } from './HouseFacade.js';

/** Timbers stand this far out of the plaster face they frame. */
const PROUD = 0.115;
const FACE_D = 0.025;

/** Facade-space extent of an opening, including the frame around it. */
export function openingExtent(facade, opening, margin = 0) {
  const u = facade.length / 2 + opening.centerX;
  const height = opening.springHeight + opening.radius;
  return {
    u0: u - opening.width / 2 - margin,
    u1: u + opening.width / 2 + margin,
    y0: facade.y0 + opening.bottom - margin,
    y1: facade.y0 + opening.bottom + height + margin,
  };
}

function overlapsHorizontally(u, extents, clearance) {
  return extents.some(({ u0, u1 }) => u > u0 - clearance && u < u1 + clearance);
}

function postPositions(facade, extents, spacing, size) {
  const posts = [size / 2, facade.length - size / 2];
  // Jamb posts either side of every opening.
  for (const { u0, u1 } of extents) posts.push(u0 - size / 2, u1 + size / 2);
  const bays = Math.max(1, Math.round(facade.length / spacing));
  for (let bay = 1; bay < bays; bay += 1) {
    const u = facade.length * bay / bays;
    if (overlapsHorizontally(u, extents, size)) continue;
    posts.push(u);
  }
  const sorted = posts
    .filter((u) => u >= size / 2 - 1e-6 && u <= facade.length - size / 2 + 1e-6)
    .sort((left, right) => left - right);
  // Drop a regular post that crowds a jamb post.
  return sorted.filter((u, index) => index === 0 || u - sorted[index - 1] > size * 1.6);
}

/** Split [u0, u1] around the openings a horizontal member at height `y` would cross. */
function railSegments(u0, u1, y, extents) {
  const blockers = extents
    .filter((extent) => y > extent.y0 && y < extent.y1)
    .sort((left, right) => left.u0 - right.u0);
  const segments = [];
  let start = u0;
  for (const { u0: blockStart, u1: blockEnd } of blockers) {
    if (blockStart > start) segments.push([start, blockStart]);
    start = Math.max(start, blockEnd);
  }
  if (u1 > start) segments.push([start, u1]);
  return segments.filter(([a, b]) => b - a > 0.05);
}

function postSegments(u, y0, y1, extents) {
  const blockers = extents
    .filter((extent) => u > extent.u0 && u < extent.u1)
    .sort((left, right) => left.y0 - right.y0);
  const segments = [];
  let start = y0;
  for (const { y0: blockStart, y1: blockEnd } of blockers) {
    if (blockStart > start) segments.push([start, blockStart]);
    start = Math.max(start, blockEnd);
  }
  if (y1 > start) segments.push([start, y1]);
  return segments.filter(([a, b]) => b - a > 0.05);
}

/**
 * Half-timbering over one plastered facade.
 *
 * Posts are regular but always frame the openings; rails break around them;
 * braces fill only clear bays. `braces` is 'none', 'diagonal' (mirrored about
 * the facade centre, as carpenters set them to resist racking both ways) or
 * 'cross'. `rails` lists extra rail heights in world metres.
 */
export function timberFrame(kit, facade, {
  y0 = facade.y0,
  y1 = facade.y1,
  spacing = 1.5,
  braces = 'diagonal',
  rails = [],
  openings = [],
  size = 0.2,
} = {}) {
  const beam = (a, b, memberSize = size, proud = PROUD, extra = {}) => (
    kit.add('wood', facadeBeam(facade, a, b, memberSize, { proud, ...extra }))
  );
  const extents = openings.map((opening) => openingExtent(facade, opening, 0.02));
  const posts = postPositions(facade, extents, spacing, size);

  posts.forEach((u, postIndex) => {
    const isCorner = postIndex === 0 || postIndex === posts.length - 1;
    const isDoorJamb = openings.some((opening) => {
      if (!opening.door) return false;
      const extent = openingExtent(facade, opening, 0.02);
      return Math.abs(u - (extent.u0 - size / 2)) < 0.04 || Math.abs(u - (extent.u1 + size / 2)) < 0.04;
    });
    const postY0 = isDoorJamb ? facade.y0 : y0;
    const segments = postSegments(u, postY0, y1, extents);
    for (const [a, b] of segments) {
      if (b - a > (y1 - postY0) * 0.65) {
        addFacadeColumn(kit, facade, u, a, b, {
          size: isCorner ? size * 1.18 : isDoorJamb ? size * 1.14 : size * 1.04,
          proud: isCorner ? PROUD * 1.18 : isDoorJamb ? PROUD * 1.16 : PROUD * 1.04,
          d: FACE_D,
          foot: Math.abs(a - postY0) < 0.08,
          capital: Math.abs(b - y1) < 0.08,
          tenon: isDoorJamb,
          pegs: true,
        });
      } else {
        beam([u, a, FACE_D], [u, b, FACE_D], size, PROUD, { taper: 0.06 });
      }
    }
  });

  const railHeights = [y0 + size * 0.54, y1 - size * 0.54, ...rails];
  for (const y of railHeights) {
    const isPlate = Math.abs(y - (y0 + size * 0.54)) < 0.02 || Math.abs(y - (y1 - size * 0.54)) < 0.02;
    const railSize = isPlate ? size * 1.08 : size * 0.94;
    const railProud = isPlate ? PROUD * 1.12 : PROUD * 0.96;
    for (const [a, b] of railSegments(0, facade.length, y, extents)) {
      beam([a, y, FACE_D], [b, y, FACE_D], railSize, railProud);
    }
  }
  // Head and sill rails between each opening's jamb posts, with projecting ears.
  for (const { u0, u1, y0: bottom, y1: top } of extents) {
    const ear = size * 0.55;
    beam([u0 - ear, top + size / 2, FACE_D + 0.01], [u1 + ear, top + size / 2, FACE_D + 0.01], size * 1.06, PROUD * 1.12);
    kit.add('wood', facadePeg(facade, u0, top + size / 2, FACE_D + PROUD * 0.62));
    kit.add('wood', facadePeg(facade, u1, top + size / 2, FACE_D + PROUD * 0.62));
    if (bottom - y0 > size) {
      beam([u0 - ear, bottom - size / 2, FACE_D + 0.01], [u1 + ear, bottom - size / 2, FACE_D + 0.01], size * 1.04, PROUD * 1.14);
    }
  }

  // Corner knee braces at the top wall plate even when full-bay bracing is 'none'.
  const headY = y1 - size * 0.54;
  if (braces === 'none') {
    for (const end of [0, 1]) {
      const postU = posts[end === 0 ? 0 : posts.length - 1];
      const dir = end === 0 ? 1 : -1;
      const reach = Math.min(0.62, (y1 - y0) * 0.28);
      if (!overlapsHorizontally(postU + dir * reach * 0.5, extents, reach * 0.5)) {
        beam(
          [postU + dir * size * 0.35, headY - reach, FACE_D],
          [postU + dir * (size * 0.35 + reach), headY - size * 0.3, FACE_D],
          size * 0.82,
          PROUD * 0.92,
        );
      }
    }
    return;
  }

  const braceTop = rails.length > 0 ? Math.min(...rails) : y1 - size;
  for (let index = 1; index < posts.length; index += 1) {
    const a = posts[index - 1] + size / 2;
    const b = posts[index] - size / 2;
    if (b - a < 0.45 || overlapsHorizontally((a + b) / 2, extents, (b - a) / 2)) continue;
    const bottom = y0 + size;
    const leftHand = (a + b) / 2 < facade.length / 2;
    if (braces === 'cross') {
      beam([a, bottom, FACE_D], [b, braceTop, FACE_D], size * 0.88, PROUD * 0.94);
      beam([b, bottom, FACE_D], [a, braceTop, FACE_D], size * 0.88, PROUD * 0.94);
      kit.add('wood', facadePeg(facade, (a + b) / 2, (bottom + braceTop) / 2, FACE_D + PROUD * 0.55));
    } else {
      beam(
        leftHand ? [a, bottom, FACE_D] : [b, bottom, FACE_D],
        leftHand ? [b, braceTop, FACE_D] : [a, braceTop, FACE_D],
        size * 0.9,
        PROUD * 0.96,
      );
    }
  }
}

/**
 * Structural hand-hewn timber columns, doorway jamb posts, top wall plate and
 * corner knee braces on a stone masonry storey, matching the reference cottage's
 * combination of rubble/cobble masonry and heavy vertical timber columns.
 */
export function stoneTimberFrame(kit, facade, {
  y0 = facade.y0,
  y1 = facade.y1,
  openings = [],
  roofed = false,
} = {}) {
  const height = y1 - y0;
  if (height < 1.2) return;
  const plateSize = 0.2;
  const plateProud = 0.125;
  const plateY = y1 - (roofed ? 0.22 : plateSize * 0.52);
  const extents = openings.map((opening) => openingExtent(facade, opening, 0.04));

  // Continuous top timber wall plate / ring beam across the stone wall top.
  for (const [a, b] of railSegments(0.18, facade.length - 0.18, plateY, extents)) {
    kit.add('wood', facadeBeam(
      facade,
      [a, plateY, 0.035],
      [b, plateY, 0.035],
      plateSize,
      { proud: plateProud, bevelRatio: 0.18 },
    ));
  }

  // Diagonal corner knee braces tucked between the corner quoin boulders and the top wall plate.
  for (const end of [0, 1]) {
    const dir = end === 0 ? 1 : -1;
    const startU = end === 0 ? 0.46 : facade.length - 0.46;
    const endU = startU + dir * 0.56;
    if (endU < 0.45 || endU > facade.length - 0.45) continue;
    if (overlapsHorizontally((startU + endU) / 2, extents, 0.34)) continue;
    kit.add('wood', facadeBeam(
      facade,
      [startU, plateY - 0.58, 0.035],
      [endU, plateY - plateSize * 0.32, 0.035],
      0.145,
      { proud: 0.105, bevelRatio: 0.17 },
    ));
  }

  // Heavy hand-hewn doorway jamb columns with flared foot collars and top tenon caps.
  for (const opening of openings) {
    if (!opening.door) continue;
    const u = facade.length / 2 + opening.centerX;
    const colSize = 0.24;
    const colProud = 0.145;
    const doorTop = Math.min(plateY - plateSize * 0.4, facade.y0 + opening.bottom + opening.springHeight + opening.radius + 0.24);
    for (const side of [-1, 1]) {
      const postU = u + side * (opening.width / 2 + colSize * 0.54);
      if (postU < 0.35 || postU > facade.length - 0.35) continue;
      addFacadeColumn(kit, facade, postU, y0, doorTop, {
        size: colSize,
        proud: colProud,
        d: 0.045,
        foot: true,
        capital: true,
        tenon: true,
        pegs: true,
      });
    }
  }

  // Intermediate structural timber bay columns on longer stone walls, with knee braces to the wall plate.
  const baySpacing = 3.4;
  const bayCount = Math.max(1, Math.round(facade.length / baySpacing));
  for (let bay = 1; bay < bayCount; bay += 1) {
    const u = (facade.length * bay) / bayCount;
    if (u < 0.85 || u > facade.length - 0.85) continue;
    if (overlapsHorizontally(u, extents, 0.48)) continue;
    const colTop = plateY - plateSize * 0.45;
    addFacadeColumn(kit, facade, u, y0, colTop, {
      size: 0.22,
      proud: 0.13,
      d: 0.04,
      foot: true,
      capital: true,
      tenon: false,
      pegs: true,
    });
    // Diagonal carpenter's knee braces from the bay column up to the wall plate.
    for (const dir of [-1, 1]) {
      const braceEndU = u + dir * 0.56;
      if (braceEndU < 0.5 || braceEndU > facade.length - 0.5) continue;
      if (overlapsHorizontally((u + braceEndU) / 2, extents, 0.32)) continue;
      kit.add('wood', facadeBeam(
        facade,
        [u + dir * 0.08, colTop - 0.52, 0.035],
        [braceEndU, plateY - plateSize * 0.35, 0.035],
        0.14,
        { proud: 0.1, bevelRatio: 0.17 },
      ));
    }
  }
}
