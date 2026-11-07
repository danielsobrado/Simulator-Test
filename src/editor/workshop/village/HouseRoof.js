import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledBox,
  normalizeGeometry,
  quarterTurnUv,
} from '../ProceduralWorkshopGeometry.js';
import { beamBetween, facadeBeam, facadeAt } from './HouseFacade.js';
import { createRoofSurface } from './HouseRoofSurface.js';
import { addRoofTrim } from './HouseRoofTrim.js';

const DECK_THICKNESS = 0.12;
export const TILES_PER_ROOF = 900;
const TILE_WIDTH = 0.3;
const TILE_COURSE = 0.3;
const TILE_THICKNESS = 0.045;

/**
 * Triangulate a (columns+1) × (rows+1) point grid, wound so its normals face
 * `outward`. Degenerate cells at a hip apex contribute zero area and no normal.
 */
function gridGeometry(points, columns, rows, outward) {
  const positions = new Float32Array(points.flat());
  const indices = [];
  const at = (column, row) => row * (columns + 1) + column;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      indices.push(at(column, row), at(column + 1, row), at(column, row + 1));
      indices.push(at(column + 1, row), at(column + 1, row + 1), at(column, row + 1));
    }
  }
  // Orient by the summed triangle normal rather than one sample, which may be degenerate.
  const total = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let index = 0; index < indices.length; index += 3) {
    a.fromArray(positions, indices[index] * 3);
    b.fromArray(positions, indices[index + 1] * 3);
    c.fromArray(positions, indices[index + 2] * 3);
    total.add(new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)));
  }
  if (total.dot(new THREE.Vector3(...outward)) < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return applyWorkshopProjectedUv(normalizeGeometry(geometry));
}

/** A thin vertical strip between an upper edge and the same edge lowered by the deck. */
function rimGeometry(edge, outward) {
  const points = [...edge, ...edge.map(([x, y, z]) => [x, y - DECK_THICKNESS, z])];
  return gridGeometry(points, edge.length - 1, 1, outward);
}

/**
 * The faces of a roof as parametric patches: `point(s, r)` with `s` across the
 * face from 0 to 1 and `r` from ridge (0) to eaves (1).
 */
function roofFaces(surface) {
  const faces = [];
  const { eaves, hipRun, ridgeHalf, halfLength } = surface;
  for (const side of [-1, 1]) {
    faces.push({
      kind: 'side',
      sign: side,
      span: (r) => 2 * (ridgeHalf + hipRun * r),
      point: (s, r) => {
        const half = ridgeHalf + hipRun * r;
        const a = -half + 2 * half * s;
        return surface.toWorld(a, surface.height(r, a), side * eaves * r);
      },
      outward: [surface.acrossAxis[0] * side, 0, surface.acrossAxis[1] * side],
      alongOutward: [surface.alongAxis[0], 0, surface.alongAxis[1]],
    });
  }
  if (hipRun > 1e-3) {
    for (const end of [-1, 1]) {
      faces.push({
        kind: 'hip',
        sign: end,
        span: (r) => 2 * eaves * r,
        point: (s, r) => {
          const c = -eaves * r + 2 * eaves * r * s;
          return surface.toWorld(end * (ridgeHalf + hipRun * r), surface.height(r, end * ridgeHalf), c);
        },
        outward: [surface.alongAxis[0] * end, 0, surface.alongAxis[1] * end],
      });
    }
  }
  return { faces, gabled: hipRun <= 1e-3, halfLength };
}

function deckGeometries(face, rows, columns, gabled) {
  const top = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      top.push(face.point(column / columns, row / rows));
    }
  }
  const bottom = top.map(([x, y, z]) => [x, y - DECK_THICKNESS, z]);
  const eaveEdge = top.slice(rows * (columns + 1));
  const result = [
    gridGeometry(top, columns, rows, [0, 1, 0]),
    gridGeometry(bottom, columns, rows, [0, -1, 0]),
    rimGeometry(eaveEdge, face.outward),
  ];
  if (gabled && face.kind === 'side') {
    for (const column of [0, columns]) {
      const edge = [];
      for (let row = 0; row <= rows; row += 1) edge.push(top[row * (columns + 1) + column]);
      const sign = column === 0 ? -1 : 1;
      result.push(rimGeometry(edge, face.alongOutward.map((value) => value * sign)));
    }
  }
  return result;
}

function faceBasis(face, s, r, span) {
  const epsilon = 1e-3;
  const p = new THREE.Vector3(...face.point(s, r));
  const down = new THREE.Vector3(...face.point(s, Math.min(1, r + epsilon)))
    .sub(new THREE.Vector3(...face.point(s, Math.max(0, r - epsilon))));
  const lateralStep = epsilon / Math.max(0.1, span);
  const lateral = new THREE.Vector3(...face.point(Math.min(1, s + lateralStep), r))
    .sub(new THREE.Vector3(...face.point(Math.max(0, s - lateralStep), r)));
  const z = down.normalize();
  let y = new THREE.Vector3().crossVectors(z, lateral).normalize();
  if (y.y < 0) y.negate();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  y = new THREE.Vector3().crossVectors(z, x).normalize();
  return { position: p, basis: new THREE.Matrix4().makeBasis(x, y, z), normal: y };
}

/** Individual overlapping tiles, sized so each roof stays inside its budget. */
function addTiles(kit, faces, slantLength) {
  const estimate = faces.reduce((sum, face) => (
    sum + Math.ceil(slantLength / TILE_COURSE) * Math.ceil(face.span(0.5) / TILE_WIDTH)
  ), 0);
  const scale = Math.max(1, Math.sqrt(estimate / TILES_PER_ROOF));
  const course = TILE_COURSE * scale;
  const width = TILE_WIDTH * scale;
  const rows = Math.max(3, Math.round(slantLength / course));
  for (const face of faces) {
    for (let row = 0; row < rows; row += 1) {
      const r = (row + 0.5) / rows;
      const span = face.span(r);
      const count = Math.max(1, Math.round(span / width));
      // Quarter-step alternation: rows break joint by half a tile while every
      // row keeps the same extent, as the tower shingles do.
      const stagger = row % 2 === 0 ? -0.25 : 0.25;
      for (let column = 0; column < count; column += 1) {
        const s = Math.min(1, Math.max(0, (column + 0.5 + (count > 1 ? stagger : 0)) / count));
        const { position, basis, normal } = faceBasis(face, s, r, span);
        const tile = beveledBox({
          width: span / count * 1.04,
          height: TILE_THICKNESS,
          depth: slantLength / rows * 1.45,
          detail: 1,
          bevelRatio: 0.14,
        });
        const wobble = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
          -0.05 - kit.random() * 0.04,
          (kit.random() - 0.5) * 0.05,
          (kit.random() - 0.5) * 0.03,
        ));
        tile.applyMatrix4(wobble);
        tile.applyMatrix4(basis);
        tile.translate(...position.addScaledVector(normal, TILE_THICKNESS / 2 + 0.012).toArray());
        kit.add('roof', kit.shade(tile, 'roof', 1 - r));
        kit.stats.roofTiles += 1;
      }
    }
  }
}

/** Thin battens across each face, standing in for tile courses below Ultra detail. */
function addBattens(kit, faces, slantLength) {
  const rows = Math.max(4, Math.round(slantLength / 0.34));
  for (const face of faces) {
    for (let row = 1; row < rows; row += 1) {
      const r = row / rows;
      const segments = 4;
      for (let index = 0; index < segments; index += 1) {
        const lift = (s) => {
          const { position, normal } = faceBasis(face, s, r, face.span(r));
          return position.addScaledVector(normal, 0.025).toArray();
        };
        kit.add('roof', beamBetween(lift(index / segments), lift((index + 1) / segments), 0.1, { depth: 0.045 }));
      }
    }
  }
}

function ridgeCaps(kit, surface) {
  const segments = 6;
  const { ridgeHalf, hipRun, eaves } = surface;
  const ridgeEnd = hipRun > 1e-3 ? ridgeHalf : surface.halfLength;
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const a = -ridgeEnd + 2 * ridgeEnd * index / segments;
    points.push(surface.toWorld(a, surface.ridgeHeight(a) + 0.04, 0));
  }
  for (let index = 1; index < points.length; index += 1) {
    kit.add('roof', beamBetween(points[index - 1], points[index], 0.2, { depth: 0.16 }));
  }
  if (hipRun <= 1e-3) return;
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      let previous = null;
      for (let step = 0; step <= 5; step += 1) {
        const r = step / 5;
        const point = surface.toWorld(end * (ridgeHalf + hipRun * r), surface.height(r, end * ridgeHalf) + 0.04, side * eaves * r);
        if (previous) kit.add('roof', beamBetween(previous, point, 0.16, { depth: 0.12 }));
        previous = point;
      }
    }
  }
}

/** The facade of a gable end, with u = 0 at the corner where c = +halfDepth. */
function gableFacade(surface, end) {
  const normal = [surface.alongAxis[0] * end, surface.alongAxis[1] * end];
  const corner = surface.toWorld(end * surface.halfSpan, 0, end * surface.halfDepth);
  return facadeAt([corner[0], corner[2]], normal, surface.halfDepth * 2, surface.wallTop, surface.ridgeHeight(end * surface.halfSpan));
}

function gableProfile(surface, end, drop) {
  const samples = 10;
  const points = [];
  for (let index = 0; index <= samples * 2; index += 1) {
    const r = surface.wallRatio * Math.abs(index - samples) / samples;
    const side = index < samples ? 1 : -1;
    points.push([side * surface.eaves * r, surface.height(r, end * surface.halfSpan) - drop]);
  }
  return points;
}

/** Triangular (or bell-cast) infill closing a gable end under the roof deck. */
function gablePanel(kit, surface, end, material, thickness = 0.2) {
  const shape = new THREE.Shape();
  const profile = gableProfile(surface, end, 0.03);
  profile.forEach(([c, y], index) => {
    const x = -end * c;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  const along = new THREE.Vector3(surface.alongAxis[0] * end, 0, surface.alongAxis[1] * end);
  const across = new THREE.Vector3(-surface.acrossAxis[0] * end, 0, -surface.acrossAxis[1] * end);
  const origin = surface.toWorld(end * (surface.halfSpan - thickness / 2), 0, 0);
  geometry.applyMatrix4(new THREE.Matrix4()
    .makeBasis(across, new THREE.Vector3(0, 1, 0), along)
    .setPosition(origin[0], 0, origin[2]));
  const infill = applyWorkshopProjectedUv(normalizeGeometry(geometry));
  // Boarded gables are upright boards, grained up the gable like the walls below.
  kit.add(material === 'boards' ? 'wood' : 'mortar', material === 'boards' ? quarterTurnUv(infill) : infill);
}

/** King post, collar and raking members on a plastered gable. */
function gableTimbers(kit, surface, end) {
  const facade = gableFacade(surface, end);
  const size = 0.17;
  const beam = (a, b) => kit.add('wood', facadeBeam(facade, a, b, size, { proud: 0.09 }));
  const halfDepth = surface.halfDepth;
  const ridge = surface.ridgeHeight(end * surface.halfSpan);
  // The tie beam sits just under the wall top: at the corners the roof deck
  // meets the wall line at exactly `wallTop`, so anything above it shows
  // through the tiles as a stub.
  const tieY = surface.wallTop - size / 2 - 0.03;
  beam([0, tieY, 0.02], [halfDepth * 2, tieY, 0.02]);
  beam([halfDepth, surface.wallTop, 0.02], [halfDepth, ridge - 0.12, 0.02]);
  const collarY = surface.wallTop + (ridge - surface.wallTop) * 0.45;
  const collarR = Math.min(surface.wallRatio, surface.distanceAtHeight(collarY + 0.1, end * surface.halfSpan));
  const collarHalf = collarR * surface.eaves;
  beam([halfDepth - collarHalf, collarY, 0.02], [halfDepth + collarHalf, collarY, 0.02]);
  // Raking members follow the verge under the deck. A member's vertical
  // extent grows as 1/cos(pitch), so on a steep bell-cast gable a fixed drop
  // let it break through the tiles; each segment drops by its own slope.
  const samples = 8;
  for (const sign of [-1, 1]) {
    for (let index = 0; index < samples; index += 1) {
      const r0 = surface.wallRatio * index / samples;
      const r1 = surface.wallRatio * (index + 1) / samples;
      const y0 = surface.height(r0, end * surface.halfSpan);
      const y1 = surface.height(r1, end * surface.halfSpan);
      const slope = Math.atan2(Math.abs(y1 - y0), (r1 - r0) * surface.eaves);
      const drop = 0.13 + size / 2 / Math.cos(slope);
      beam(
        [halfDepth + sign * r0 * surface.eaves, y0 - drop, 0.03],
        [halfDepth + sign * r1 * surface.eaves, y1 - drop, 0.03],
      );
    }
  }
}

/**
 * Build a pitched village roof and return its surface, so dormers and
 * chimneys can be fitted to it.
 *
 * `gableEnds` maps 'start' (−a) and 'end' (+a) to 'plaster', 'boards' or null
 * (open — for an end that runs into another roof). Hipped roofs have no gables.
 */
export function buildRoof(kit, spec, { gableEnds = { start: 'plaster', end: 'plaster' }, gableFrame = false, tiles = null } = {}) {
  // A hand-built ridge is never quite straight: a few centimetres of settle
  // unless the design asks for its own sag.
  const sag = spec.sag ?? (0.04 + kit.random() * 0.08) * Math.min(1.5, (spec.x1 - spec.x0 + spec.z1 - spec.z0) / 12);
  const surface = createRoofSurface({ ...spec, sag });
  const { faces, gabled } = roofFaces(surface);
  const rows = surface.sweep > 0.01 ? 8 : 2;
  for (const face of faces) {
    const columns = Math.max(2, Math.ceil(face.span(1) / 0.9));
    kit.addAll('roof', deckGeometries(face, rows, columns, gabled));
  }
  ridgeCaps(kit, surface);
  const slantLength = Math.hypot(surface.eaves, surface.rise * surface.eaves / surface.halfDepth);
  const useTiles = tiles ?? kit.recipe.detail >= 3;
  if (useTiles) addTiles(kit, faces, slantLength);
  else addBattens(kit, faces, slantLength);
  addRoofTrim(kit, surface, faces, { gabled, gableEnds, deck: DECK_THICKNESS });
  if (gabled) {
    for (const [key, end] of [['start', -1], ['end', 1]]) {
      // A log-built town boards its gables: plaster over logs is a different house.
      const material = gableEnds[key] === 'plaster' && kit.recipe.walls === 'logs' ? 'boards' : gableEnds[key];
      if (!material) continue;
      gablePanel(kit, surface, end, material);
      if (gableFrame && material === 'plaster') gableTimbers(kit, surface, end);
    }
  }
  return surface;
}
