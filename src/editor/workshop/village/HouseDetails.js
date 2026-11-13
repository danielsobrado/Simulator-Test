import { beveledBox, cylinder } from '../ProceduralWorkshopGeometry.js';
import { buildWallCourses, stackCourses } from '../ProceduralWorkshopMasonry.js';
import { createRandom, mixSeed } from '../ProceduralRandom.js';
import { beamBetween, boxFacades, facadeBeam, facadePoint } from './HouseFacade.js';

/**
 * A coursed stone chimney stack with chunky corner quoin boulders, a stepped
 * necking band, a coping slab and clay pots.
 *
 * Each face is laid with the same packed courses as the walls, around a mortar
 * core, so the stack reads as built stone rather than a textured box.
 */
export function buildChimney(kit, { x, z, width = 0.9, depth = 0.9, y0, y1, pots = 2 }) {
  const shell = 0.2;
  const box = { x0: x - width / 2, x1: x + width / 2, z0: z - depth / 2, z1: z + depth / 2, y0, y1 };
  kit.add('mortar', beveledBox({
    width: width - shell,
    height: y1 - y0,
    depth: depth - shell,
    position: [x, (y0 + y1) / 2, z],
    detail: 1,
  }));
  const facades = boxFacades({ ...box, thickness: shell });
  for (const facade of Object.values(facades)) {
    const inset = facade.side === 'left' || facade.side === 'right' ? shell : 0;
    const centre = facadePoint(facade, facade.length / 2, 0, -shell / 2);
    for (const stone of buildWallCourses(kit.recipe, {
      width: facade.length - inset * 2,
      depth: shell,
      height: y1 - y0,
      centerX: centre[0],
      centerZ: centre[2],
      yaw: facade.yaw,
      seedOffset: kit.seedOffset(),
    })) {
      kit.add('stone', stone.translate(0, y0, 0));
    }
  }
  // Sculpted irregular corner boulders along the front and back faces of the chimney stack.
  const quoinCourses = stackCourses(
    y1 - y0,
    0.42,
    createRandom(mixSeed(kit.recipe.seed, kit.seedOffset() + 0xc413)),
  );
  for (const side of ['front', 'back']) {
    const facade = facades[side];
    for (const end of [0, 1]) {
      for (let row = 0; row < quoinCourses.length; row += 1) {
        const course = quoinCourses[row];
        const long = (row + end) % 2 === 0;
        const length = Math.min(facade.length * 0.48, long ? 0.38 : 0.26);
        const u = end === 0 ? length / 2 - 0.02 : facade.length - length / 2 + 0.02;
        kit.stone({
          width: length,
          height: course.height * 0.94,
          depth: shell + 0.07,
          position: facadePoint(facade, u, y0 + course.y, -shell / 2 + 0.035),
          rotation: [0, facade.yaw, 0],
          batter: row === 0 ? 0.14 : 0.04,
        }, { category: 'boulder', heightRatio: row / Math.max(1, quoinCourses.length) });
      }
    }
  }
  kit.stone({
    width: width + 0.18,
    height: 0.15,
    depth: depth + 0.18,
    position: [x, y1 + 0.075, z],
    batter: 0.12,
  }, { category: 'coping', heightRatio: 1 });
  for (let index = 0; index < pots; index += 1) {
    const offset = pots === 1 ? 0 : (index / (pots - 1) - 0.5) * width * 0.5;
    kit.add('stone', kit.shade(cylinder({
      radius: 0.1,
      radiusTop: 0.085,
      radiusBottom: 0.11,
      height: 0.42,
      position: [x + offset, y1 + 0.35, z],
      sides: 10,
    }), 'stone', 1));
  }
}

/**
 * A straight flight from `from` to `to` (world points; `to` is the top
 * landing). Stone flights are solid blocks down to `from.y`; timber flights are
 * treads on a pair of strings.
 */
export function buildStairs(kit, from, to, { width = 1.1, steps = 8, material = 'stone' } = {}) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const run = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const rise = (to[1] - from[1]) / steps;
  const tread = run / steps;
  for (let step = 0; step < steps; step += 1) {
    const t = (step + 0.5) / steps;
    const top = from[1] + rise * (step + 1);
    const centre = [from[0] + dx * t, 0, from[2] + dz * t];
    if (material === 'stone') {
      const height = top - from[1] + 0.2;
      kit.stone({
        width,
        height,
        depth: tread * 1.04,
        position: [centre[0], top - height / 2, centre[2]],
        rotation: [0, yaw, 0],
      }, { category: 'ashlar', heightRatio: step / steps });
    } else {
      kit.add('wood', beveledBox({
        width,
        height: 0.06,
        depth: tread * 1.1,
        position: [centre[0], top - 0.03, centre[2]],
        rotation: [0, yaw, 0],
        detail: 1,
      }));
    }
  }
  if (material !== 'stone') {
    const side = [Math.cos(yaw), 0, -Math.sin(yaw)];
    for (const edge of [-1, 1]) {
      const offset = (width / 2 + 0.04) * edge;
      kit.add('wood', beamBetween(
        [from[0] + side[0] * offset, from[1] - 0.1, from[2] + side[2] * offset],
        [to[0] + side[0] * offset, to[1] - 0.05, to[2] + side[2] * offset],
        0.07,
        { depth: 0.22 },
      ));
    }
  }
}

/** A board hung from an iron bracket projecting off a facade. */
export function buildHangingSign(kit, facade, u, y, { out = 1.0 } = {}) {
  kit.add('metal', facadeBeam(facade, [u, y, 0], [u, y, out], 0.05, { proud: 0.05 }));
  kit.add('metal', facadeBeam(facade, [u, y - 0.45, 0], [u, y, out * 0.6], 0.035, { proud: 0.035 }));
  const boardCentre = facadePoint(facade, u, y - 0.42, out * 0.6);
  for (const offset of [-0.22, 0.22]) {
    const hook = facadePoint(facade, u, y, out * 0.6 + offset);
    kit.add('metal', beamBetween(hook, [hook[0], y - 0.12, hook[2]], 0.02));
  }
  kit.add('wood', beveledBox({
    width: 0.06,
    height: 0.56,
    depth: 0.7,
    position: boardCentre,
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.2,
  }));
}

/** An open lean-to on posts against a facade, roofed with boards. */
export function buildLeanTo(kit, facade, { u0, u1, reach, high, low, posts = 3 }) {
  const corners = [
    facadePoint(facade, u0, high, 0),
    facadePoint(facade, u1, high, 0),
    facadePoint(facade, u1, low, reach),
    facadePoint(facade, u0, low, reach),
  ];
  const boards = Math.max(4, Math.round((u1 - u0) / 0.28));
  for (let index = 0; index < boards; index += 1) {
    const u = u0 + (u1 - u0) * (index + 0.5) / boards;
    kit.add('wood', facadeBeam(facade, [u, high + 0.04, -0.05], [u, low + 0.04, reach + 0.25], (u1 - u0) / boards * 0.96, { proud: 0.05 }));
  }
  kit.add('wood', beamBetween(corners[3], corners[2], 0.16, { depth: 0.2 }));
  for (let index = 0; index < posts; index += 1) {
    const u = u0 + 0.12 + (u1 - u0 - 0.24) * index / Math.max(1, posts - 1);
    const foot = facadePoint(facade, u, -0.3, reach - 0.1);
    const head = facadePoint(facade, u, low - 0.1, reach - 0.1);
    kit.add('wood', beamBetween(foot, head, 0.18));
    kit.add('wood', facadeBeam(facade, [u, low - 0.1, 0], [u, low - 0.1, reach - 0.1], 0.14, { proud: 0.14 }));
    kit.add('wood', beamBetween(
      facadePoint(facade, u, low - 0.8, reach - 0.1),
      facadePoint(facade, u, low - 0.15, reach - 0.8),
      0.1,
    ));
  }
}

/** A stone forge hearth with glowing coals, and an anvil on a timber block. */
export function buildForge(kit, facade, u, reach) {
  const hearth = facadePoint(facade, u, 0.38, reach * 0.4);
  kit.stone({
    width: 1.5,
    height: 0.9,
    depth: 1.0,
    position: [hearth[0], 0.3, hearth[2]],
    rotation: [0, facade.yaw, 0],
  }, { category: 'ashlar', heightRatio: 0.2 });
  for (let index = 0; index < 7; index += 1) {
    const coal = facadePoint(facade, u + (kit.random() - 0.5) * 0.8, 0.78, reach * 0.4 + (kit.random() - 0.5) * 0.5);
    kit.add('glow', beveledBox({
      width: 0.16 + kit.random() * 0.1,
      height: 0.07,
      depth: 0.14 + kit.random() * 0.1,
      position: coal,
      rotation: [0, kit.random() * Math.PI, 0],
      detail: 1,
      bevelRatio: 0.3,
    }));
  }
  const anvil = facadePoint(facade, u + 1.6, 0, reach * 0.55);
  kit.add('wood', cylinder({ radius: 0.24, height: 0.5, position: [anvil[0], 0.25, anvil[2]], sides: 10 }));
  kit.add('metal', beveledBox({ width: 0.22, height: 0.2, depth: 0.5, position: [anvil[0], 0.6, anvil[2]], rotation: [0, facade.yaw, 0], detail: 1 }));
  kit.add('metal', beveledBox({ width: 0.3, height: 0.12, depth: 0.72, position: [anvil[0], 0.76, anvil[2]], rotation: [0, facade.yaw, 0], detail: 1 }));
}

/** A raised plank deck on posts. Boards run across x with ragged ends. */
export function buildDeck(kit, { x0, x1, z0, z1, y }) {
  const board = 0.3;
  for (let x = x0; x < x1 - 0.05; x += board + 0.03) {
    const start = z0 - kit.random() * 0.35;
    const end = z1 + kit.random() * 0.35;
    kit.add('wood', beveledBox({
      width: board,
      height: 0.07,
      depth: end - start,
      position: [x + board / 2, y - 0.035, (start + end) / 2],
      detail: 1,
      bevelRatio: 0.15,
    }));
  }
  for (const z of [z0 + 0.2, z1 - 0.2]) {
    kit.add('wood', beamBetween([x0, y - 0.16, z], [x1, y - 0.16, z], 0.2));
    for (let x = x0 + 0.2; x <= x1 - 0.1; x += 1.6) {
      kit.add('wood', beamBetween([x, -0.4, z], [x, y - 0.25, z], 0.2));
    }
  }
}
