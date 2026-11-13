import * as THREE from 'three/webgpu';
import { archedPanel, beveledBox, leaf, quarterTurnUv } from '../ProceduralWorkshopGeometry.js';
import { FOLIAGE_BASE_COLOR } from '../ProceduralWorkshopMaterials.js';
import { tagOpeningGeometry } from '../ProceduralWorkshopSemantics.js';
import { facadeBeam, facadeMatrix, facadePeg, facadePoint } from './HouseFacade.js';

const FRAME = 0.115;
const FRAME_PROUD = 0.095;
const STONE_DRESSING_DEPTH = 0.3;

/** Facade-space geometry of a resolved opening. */
function frameOf(facade, opening) {
  const u = facade.length / 2 + opening.centerX;
  const bottom = facade.y0 + opening.bottom;
  const arched = !opening.rectangular && opening.radius > 0.05;
  const height = opening.springHeight + opening.radius;
  return {
    u,
    bottom,
    width: opening.width,
    height,
    arched,
    springY: bottom + (arched ? opening.springHeight : height),
    radius: arched ? opening.width / 2 : 0,
  };
}

/** An arched or rectangular panel lying in the facade plane at depth `d`. */
function panel(facade, frame, d, depth, { inset = 0 } = {}) {
  const width = Math.max(0.1, frame.width - inset * 2);
  const geometry = frame.arched
    ? archedPanel({
      width,
      springHeight: Math.max(0.05, frame.springY - frame.bottom - inset),
      radius: Math.max(0.05, frame.radius - inset),
      depth,
      position: [frame.u, frame.bottom + inset, d],
    })
    : beveledBox({
      width,
      height: Math.max(0.1, frame.height - inset * 2),
      depth,
      position: [frame.u, frame.bottom + frame.height / 2, d],
      detail: 1,
      bevelRatio: 0.06,
    });
  // Door and shutter leaves are upright boards: grain up the leaf.
  return quarterTurnUv(geometry.applyMatrix4(facadeMatrix(facade)));
}

/** Timber members around the opening, with overhanging eared lintels, pegs, and segmented arch heads. */
function timberSurround(facade, frame, d, size, { sill = false } = {}) {
  const beams = [];
  const beam = (a, b, memberSize = size, proud = FRAME_PROUD) => (
    beams.push(facadeBeam(facade, a, b, memberSize, { proud }))
  );
  const left = frame.u - frame.width / 2 - size / 2;
  const right = frame.u + frame.width / 2 + size / 2;
  beam([left, frame.bottom - (sill ? size * 0.35 : 0), d], [left, frame.springY + size * 0.25, d]);
  beam([right, frame.bottom - (sill ? size * 0.35 : 0), d], [right, frame.springY + size * 0.25, d]);
  if (frame.arched) {
    const segments = 7;
    const radius = frame.radius + size / 2;
    for (let index = 0; index < segments; index += 1) {
      const a0 = Math.PI * index / segments;
      const a1 = Math.PI * (index + 1) / segments;
      beam(
        [frame.u + Math.cos(a0) * radius, frame.springY + Math.sin(a0) * radius, d],
        [frame.u + Math.cos(a1) * radius, frame.springY + Math.sin(a1) * radius, d],
      );
    }
  } else {
    const ear = size * 0.72;
    beam(
      [left - ear, frame.springY + size * 0.55, d + 0.012],
      [right + ear, frame.springY + size * 0.55, d + 0.012],
      size * 1.18,
      FRAME_PROUD * 1.18,
    );
    beams.push(facadePeg(facade, left, frame.springY + size * 0.55, d + FRAME_PROUD * 0.65));
    beams.push(facadePeg(facade, right, frame.springY + size * 0.55, d + FRAME_PROUD * 0.65));
  }
  if (sill) {
    const sillEar = size * 0.68;
    beam(
      [left - sillEar, frame.bottom - size * 0.48, d + 0.018],
      [right + sillEar, frame.bottom - size * 0.48, d + 0.018],
      size * 1.12,
      FRAME_PROUD * 1.24,
    );
  }
  return beams;
}

/**
 * Glazing bars: a transom, mullions, and diagonal diamond-lattice muntins across
 * each casement pane, matching the diamond-leaded cottage windows in the reference.
 */
function glazingBars(facade, frame, opening, d) {
  const bars = [];
  const bar = (a, b, size = 0.045, proud = 0.035) => bars.push(facadeBeam(facade, a, b, size, { proud }));
  const members = opening.memberOpenings ?? [];
  const boundaries = [];
  for (let index = 1; index < members.length; index += 1) {
    const previous = members[index - 1];
    const next = members[index];
    const edge = (previous.assemblySurfaceX + previous.width / 2 + next.assemblySurfaceX - next.width / 2) / 2;
    boundaries.push(frame.u + edge - opening.centerX);
  }
  if (boundaries.length === 0 && frame.width > 0.5) boundaries.push(frame.u);
  for (const u of boundaries) bar([u, frame.bottom, d], [u, frame.springY, d]);
  const transom = frame.bottom + (frame.springY - frame.bottom) * 0.62;
  bar([frame.u - frame.width / 2, transom, d], [frame.u + frame.width / 2, transom, d]);

  // Diamond-lattice diagonal muntin bars inside each pane.
  const paneEdges = [frame.u - frame.width / 2, ...boundaries, frame.u + frame.width / 2];
  const y0 = frame.bottom + 0.03;
  const y1 = frame.springY - 0.03;
  const yMid = (y0 + y1) / 2;
  for (let i = 0; i < paneEdges.length - 1; i += 1) {
    const u0 = paneEdges[i] + 0.03;
    const u1 = paneEdges[i + 1] - 0.03;
    if (u1 - u0 < 0.14 || y1 - y0 < 0.22) continue;
    const uMid = (u0 + u1) / 2;
    bar([u0, yMid, d], [uMid, y1, d], 0.03, 0.024);
    bar([uMid, y1, d], [u1, yMid, d], 0.03, 0.024);
    bar([u1, yMid, d], [uMid, y0, d], 0.03, 0.024);
    bar([uMid, y0, d], [u0, yMid, d], 0.03, 0.024);
    bar([u0, y0, d], [u1, y1, d], 0.028, 0.022);
    bar([u1, y0, d], [u0, y1, d], 0.028, 0.022);
  }
  return bars;
}

/** Quaternion-composed rotation: the facade's yaw, then a roll in the facade plane. */
function facadeRoll(facade, roll) {
  const quaternion = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), facade.yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  return [euler.x, euler.y, euler.z];
}

/** Voussoirs round an arch, or an overhanging eared lintel over a square head, plus jamb blocks and sill. */
function stoneDressings(kit, facade, frame, thickness, { sill, door = false }) {
  const outerProud = 0.06;
  const d = -thickness / 2 + outerProud / 2;
  if (frame.arched) {
    const ringRadius = frame.radius + STONE_DRESSING_DEPTH / 2;
    const count = Math.max(5, 2 * Math.round(Math.PI * ringRadius / 0.48) + 1);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * (index + 0.5) / count;
      kit.stone({
        width: Math.PI * ringRadius / count * 0.92,
        height: STONE_DRESSING_DEPTH,
        depth: thickness + outerProud,
        position: facadePoint(
          facade,
          frame.u + Math.cos(angle) * ringRadius,
          frame.springY + Math.sin(angle) * ringRadius,
          d,
        ),
        rotation: facadeRoll(facade, angle - Math.PI / 2),
      }, { category: 'voussoir', heightRatio: 0.7 });
    }
  } else {
    kit.stone({
      width: frame.width + 0.56,
      height: 0.28,
      depth: thickness + outerProud + 0.03,
      position: facadePoint(facade, frame.u, frame.springY + 0.14, d + 0.015),
      rotation: [0, facade.yaw, 0],
    }, { category: 'quoin', heightRatio: 0.7 });
  }
  // Alternating sculpted stone jamb blocks on windows (doorways have heavy timber jamb columns).
  if (!door) {
    const jambRows = Math.max(2, Math.round((frame.springY - frame.bottom) / 0.28));
    const rowHeight = (frame.springY - frame.bottom) / jambRows;
    for (const side of [-1, 1]) {
      for (let row = 0; row < jambRows; row += 1) {
        const long = (row + (side > 0 ? 1 : 0)) % 2 === 0;
        const jambWidth = long ? 0.24 : 0.17;
        const u = frame.u + side * (frame.width / 2 + jambWidth / 2);
        kit.stone({
          width: jambWidth,
          height: rowHeight * 0.94,
          depth: thickness + outerProud + (long ? 0.025 : 0.01),
          position: facadePoint(facade, u, frame.bottom + rowHeight * (row + 0.5), d + 0.01),
          rotation: [0, facade.yaw, 0],
        }, { category: 'quoin', heightRatio: 0.5 });
      }
    }
  }
  if (sill) {
    kit.stone({
      width: frame.width + 0.36,
      height: 0.15,
      depth: thickness + 0.15,
      position: facadePoint(facade, frame.u, frame.bottom - 0.075, d + 0.055),
      rotation: [0, facade.yaw, 0],
    }, { category: 'quoin', heightRatio: 0.3 });
  }
}

function shutterPair(facade, frame, d) {
  const shutters = [];
  const width = frame.width / 2;
  const height = frame.springY - frame.bottom;
  for (const side of [-1, 1]) {
    const u = frame.u + side * (frame.width / 2 + FRAME + width / 2 + 0.02);
    shutters.push(beveledBox({
      width,
      height,
      depth: 0.04,
      position: facadePoint(facade, u, frame.bottom + height / 2, d),
      rotation: [0, facade.yaw, 0],
      detail: 1,
      bevelRatio: 0.1,
    }));
    for (const ledge of [0.2, 0.8]) {
      shutters.push(facadeBeam(
        facade,
        [u - width / 2 + 0.03, frame.bottom + height * ledge, d + 0.02],
        [u + width / 2 - 0.03, frame.bottom + height * ledge, d + 0.02],
        0.07,
        { proud: 0.03 },
      ));
    }
  }
  return shutters;
}

/** Window-box blossoms as linear colour: geranium, rose, cream and violet, weathered rather than bright. */
const BLOSSOMS = Object.freeze([[0.55, 0.07, 0.05], [0.6, 0.22, 0.28], [0.72, 0.66, 0.5], [0.3, 0.16, 0.42]]);
const FOLIAGE_BASE = new THREE.Color(FOLIAGE_BASE_COLOR);

/** A blossom's vertex colour: the foliage material multiplies its green base in, so divide it out. */
function blossomColour(rgb) {
  return [rgb[0] / FOLIAGE_BASE.r, rgb[1] / FOLIAGE_BASE.g, rgb[2] / FOLIAGE_BASE.b];
}

function flowerBox(kit, facade, frame, d) {
  const width = Math.max(0.45, frame.width * 0.95);
  const y = frame.bottom - 0.16;
  const pieces = [['wood', beveledBox({
    width,
    height: 0.16,
    depth: 0.24,
    position: facadePoint(facade, frame.u, y, d + 0.12),
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.14,
  })]];
  const blooms = Math.max(5, Math.round(width / 0.1));
  for (let index = 0; index < blooms; index += 1) {
    const u = frame.u - width * 0.42 + width * 0.84 * index / Math.max(1, blooms - 1);
    pieces.push(['foliage', leaf({
      radius: 0.07 + kit.random() * 0.035,
      position: facadePoint(facade, u, y + 0.12 + kit.random() * 0.1, d + 0.1 + kit.random() * 0.08),
      rotation: [kit.random(), kit.random() + facade.yaw, kit.random() * Math.PI],
      color: [0.36 + kit.random() * 0.2, 0.55 + kit.random() * 0.2, 0.25],
    })]);
    // Every plant is in flower, as the kit towns' window boxes are.
    const blossom = BLOSSOMS[(index + Math.floor(kit.random() * 2)) % BLOSSOMS.length];
    pieces.push(['foliage', leaf({
      radius: 0.07,
      position: facadePoint(facade, u, y + 0.21 + kit.random() * 0.06, d + 0.17),
      rotation: [Math.PI / 2 - 0.5, facade.yaw, kit.random() * Math.PI],
      color: blossomColour(blossom),
    })]);
  }
  return pieces;
}

function emit(kit, pieces, opening) {
  for (const [slot, geometry] of pieces) {
    if (!geometry) continue;
    if (opening.componentId) tagOpeningGeometry(geometry, opening, opening.door);
    kit.add(slot, geometry);
  }
}

/**
 * A window in a facade.
 *
 * In a plaster wall the casement stands proud of the continuous shell; in a
 * stone wall the glass sits back inside the void the courses left and the head
 * is dressed with voussoirs or a lintel. Editable windows keep their component
 * tag on every insert piece so they select and regenerate as one opening.
 */
export function buildWindow(kit, facade, opening, {
  wall = 'plaster',
  thickness = 0.22,
  shutters = false,
  flowers = false,
} = {}) {
  const frame = frameOf(facade, opening);
  const pieces = [];
  if (wall === 'stone') {
    const d = -thickness * 0.6;
    pieces.push(['recess', panel(facade, frame, d, 0.04)]);
    for (const bar of glazingBars(facade, frame, opening, d + 0.03)) pieces.push(['wood', bar]);
    if (!frame.arched) {
      for (const beam of timberSurround(facade, frame, 0.015, FRAME * 0.85, { sill: true })) pieces.push(['wood', beam]);
    }
    stoneDressings(kit, facade, frame, thickness, { sill: true, door: false });
  } else {
    pieces.push(['recess', panel(facade, frame, 0.015, 0.03)]);
    for (const beam of timberSurround(facade, frame, 0.03, FRAME, { sill: true })) pieces.push(['wood', beam]);
    for (const bar of glazingBars(facade, frame, opening, 0.04)) pieces.push(['wood', bar]);
    pieces.push(['wood', beveledBox({
      width: frame.width + 0.28,
      height: 0.08,
      depth: 0.17,
      position: facadePoint(facade, frame.u, frame.bottom - 0.04, 0.08),
      rotation: [0, facade.yaw, 0],
      detail: 1,
    })]);
    if (shutters && !frame.arched) {
      for (const shutter of shutterPair(facade, frame, 0.05)) pieces.push(['wood', shutter]);
    }
  }
  if (flowers && !opening.door) pieces.push(...flowerBox(kit, facade, frame, wall === 'stone' ? 0.02 : 0.05));
  emit(kit, pieces, { ...opening, door: false });
}

/**
 * A ledged plank door with strap hinges, set in a timber frame or a dressed
 * stone void. The recipe's `openDoorId` door is built open: frame, dressings,
 * step and void, but no leaf.
 */
export function buildDoor(kit, facade, opening, { wall = 'plaster', thickness = 0.22, step = true } = {}) {
  const frame = frameOf(facade, opening);
  const d = wall === 'stone' ? -thickness * 0.55 : 0.03;
  const pieces = [];
  const open = Boolean(opening.componentId) && opening.componentId === kit.recipe.openDoorId;
  if (open) {
    // No leaf, no hinges: the doorway is left clear.
  } else if (frame.arched) {
    pieces.push(['wood', panel(facade, frame, d, 0.06)]);
  } else {
    const boards = Math.max(3, Math.round(frame.width / 0.2));
    const boardWidth = frame.width / boards;
    for (let index = 0; index < boards; index += 1) {
      pieces.push(['wood', quarterTurnUv(beveledBox({
        width: boardWidth * 0.97,
        height: frame.height,
        depth: 0.06,
        position: facadePoint(facade, frame.u - frame.width / 2 + boardWidth * (index + 0.5), frame.bottom + frame.height / 2, d),
        rotation: [0, facade.yaw, 0],
        detail: 1,
        bevelRatio: 0.12,
      }))]);
    }
  }
  for (const ratio of open ? [] : [0.2, 0.72]) {
    const y = frame.bottom + (frame.springY - frame.bottom) * ratio;
    pieces.push(['metal', facadeBeam(
      facade,
      [frame.u - frame.width / 2 + 0.04, y, d + 0.04],
      [frame.u + frame.width * 0.2, y, d + 0.04],
      0.06,
      { proud: 0.02 },
    )]);
  }
  if (!open) {
    pieces.push(['metal', beveledBox({
      width: 0.06,
      height: 0.14,
      depth: 0.05,
      position: facadePoint(facade, frame.u + frame.width * 0.32, frame.bottom + 1.0, d + 0.05),
      rotation: [0, facade.yaw, 0],
      detail: 1,
    })]);
  }
  if (wall === 'stone') {
    stoneDressings(kit, facade, frame, thickness, { sill: false, door: true });
  } else {
    for (const beam of timberSurround(facade, frame, 0.03, 0.13)) pieces.push(['wood', beam]);
  }
  emit(kit, pieces, { ...opening, door: true });
  if (step && opening.bottom < 0.05) {
    kit.stone({
      width: frame.width + 0.36,
      height: 0.16,
      depth: 0.42,
      position: facadePoint(facade, frame.u, frame.bottom + 0.02, 0.2),
      rotation: [0, facade.yaw, 0],
    }, { category: 'ashlar', heightRatio: 0.05 });
  }
}

/** Build every opening on a facade, dispatching doors and windows. */
export function buildOpenings(kit, facade, openings, options = {}) {
  for (const opening of openings) {
    if (opening.door) buildDoor(kit, facade, opening, options);
    else buildWindow(kit, facade, opening, options);
  }
}
