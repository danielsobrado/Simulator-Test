import { createShapeWallSurface, addWallPatch } from './ShapeWallSurface.js';
import { buildShapeCourseBand, shapeStoneTone, SHAPE_ASHLAR_JOINT_TONE } from './ShapeMasonryCourses.js';
import { clipShapeMeshSet } from './ShapeRoofOcclusion.js';
import { SHAPE_CASTLE_CONFIG } from './config/ShapeCastleConfig.generated.js';

const D = SHAPE_CASTLE_CONFIG.crown;
const CELL_PROUD = 0.045, CELL_DEPTH = 0.055;
const SOFFIT_TONE = Object.freeze([0.5, 0.5, 0.5]);

/** Arch intrados as a 0..1 share of its rise, for x in -1..1 across the clear span. */
function archHead(kind, x) {
  const a = Math.min(1, Math.abs(x));
  if (kind === 'pointed') return Math.min(1, Math.sqrt(Math.max(0, 1 - ((a + 1) / 2) ** 2)) / 0.866);
  return Math.sqrt(Math.max(0, 1 - a * a));
}

/** Stretches of the crown owned by an attached turret, as [u0, u1] along the host. */
function turretSpans(plan, crown) {
  const p = plan.primitive, length = plan.curve.length;
  return (plan.features ?? []).flatMap((feature) => {
    const child = feature.child?.primitive;
    if (feature.intent?.kind !== 'turret' || !child) return [];
    const bottom = child.elevation - p.elevation, top = bottom + child.height;
    if (top < crown.base - crown.drop || bottom > crown.wallTop + p.crown.merlonHeight) return [];
    const half = (child.footprint.width / 2 + 0.04) / crown.scale;
    return [[feature.frame.u - half, feature.frame.u + half]];
  }).flatMap(([a, b]) => (plan.curve.closed ? [[a - length, b - length], [a, b], [a + length, b + length]] : [[a, b]]));
}

const overlaps = (spans, a, b) => spans.some(([s0, s1]) => a < s1 && b > s0);

/** Complement of the owned spans inside one period of the host curve. */
function freeSpans(owned, length) {
  const spans = owned.map(([a, b]) => [Math.max(0, a), Math.min(length, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const free = [];
  let at = 0;
  for (const [a, b] of spans) { if (a > at) free.push([at, a]); at = Math.max(at, b); }
  if (at < length) free.push([at, length]);
  return free;
}

/**
 * One coherent assembly on the host's own surface: corbel table, arcade, deck soffit, crown
 * wall and merlons all take their positions from the same curve, so they follow any footprint.
 */
export function buildShapeCrown(plan, sourceMeshes, recipe) {
  const crown = plan.crown;
  if (!crown) return;
  const p = plan.primitive, c = p.crown, detail = recipe.detail >= 2;
  const surface = createShapeWallSurface(plan), length = surface.length;
  const meshes = clipShapeMeshSet(sourceMeshes, plan, { roofs: false });
  const stone = meshes.trim, core = detail ? meshes.walls : meshes.trim;
  const owned = turretSpans(plan, crown), free = freeSpans(owned, length);
  // Dressed crown stone shares the wall's stone tone; `level` darkens recesses and soffits.
  const tone = (key, level = 1) => shapeStoneTone(recipe, plan, 'crown', key).map((v) => v * level);
  const joint = p.stonework === 'ashlar' ? SHAPE_ASHLAR_JOINT_TONE : [1, 1, 1];
  const steps = detail ? D.corbelSteps : 1, strips = detail ? 10 : 4;
  const segments = Math.max(8, Math.ceil(length / 0.3));
  const sides = p.kind === 'curved-wall' && c.sides === 'both' ? [1, -1] : [1];
  for (const side of sides) {
    const patch = (mesh, u0, u1, y0, y1, offset, thickness, color, caps) =>
      addWallPatch(mesh, surface, u0, u1, y0, y1, side * offset, side * thickness, color, caps);
    // Corbels step out course by course until the top stone carries the full projection.
    for (const corbel of crown.corbels) {
      if (overlaps(owned, corbel.u - corbel.du / 2, corbel.u + corbel.du / 2)) continue;
      for (let k = 0; k < steps; k++) {
        const y0 = crown.base - crown.drop + (crown.drop * k) / steps;
        const reach = (crown.projection * (k + 1)) / steps;
        patch(stone, corbel.u - corbel.du / 2, corbel.u + corbel.du / 2, y0 + (k ? 0.008 : 0), y0 + crown.drop / steps,
          crown.face + reach, reach + 0.03, tone(`${corbel.key}:${k}`), { bevel: detail });
      }
    }
    for (const bay of crown.bays) {
      if (overlaps(owned, bay.u0, bay.u1)) continue;
      const span = (bay.u1 - bay.u0) * crown.scale;
      const rise = c.arcade === 'none' ? 0
        : Math.min(span * (c.arcade === 'pointed' ? 0.8 : 0.5), crown.drop - D.arcadeLintel - 0.1);
      const intrados = (x) => crown.base - D.arcadeLintel - rise * (1 - archHead(c.arcade, x));
      for (let i = 0; i < strips; i++) {
        const u0 = bay.u0 + ((bay.u1 - bay.u0) * i) / strips, u1 = bay.u0 + ((bay.u1 - bay.u0) * (i + 1)) / strips;
        const low = [intrados((2 * i) / strips - 1), intrados((2 * (i + 1)) / strips - 1)];
        // Spandrel wall carried from corbel to corbel; its underside is the arch soffit.
        patch(stone, u0, u1, low, crown.base, crown.outer, D.arcadeDepth, tone(bay.key, 0.92), { start: false, end: false });
        if (detail && rise) patch(stone, u0 + 0.003, u1 - 0.003, low, low.map((y) => Math.min(crown.base, y + 0.11)),
          crown.outer + 0.022, 0.03, tone(`${bay.key}:v${i >> 1}`, 1.08), { back: false, start: i % 2 === 0, end: i % 2 === 1 });
        if (c.machicolation === 'none') {
          // A blind arcade: the niche is closed a hand's depth behind the arch.
          patch(stone, u0, u1, crown.base - crown.drop, crown.base, crown.outer - D.arcadeDepth * 0.6,
            crown.projection - D.arcadeDepth * 0.6, tone(bay.key, 0.7), { start: false, end: false });
        } else if (c.machicolation === 'decorative' && crown.projection > D.arcadeDepth + 0.02) {
          patch(meshes.deck ?? stone, u0, u1, crown.base - 0.1, crown.base, crown.outer - D.arcadeDepth,
            crown.projection - D.arcadeDepth, SOFFIT_TONE, { start: false, end: false });
        }
      }
    }
    // The crown wall is real coursed masonry on both faces, like the shaft below it.
    for (let i = 0; i < segments; i++) {
      const u0 = (length * i) / segments, u1 = (length * (i + 1)) / segments;
      if (overlaps(owned, u0, u1)) continue;
      patch(core, u0, u1, crown.base, crown.wallTop, crown.outer - CELL_PROUD, crown.thickness - CELL_PROUD * 2,
        detail ? joint : tone('wall'), { start: !surface.closed && i === 0, end: !surface.closed && i === segments - 1 });
    }
    const faces = [{ offset: side * crown.outer, thickness: side * CELL_DEPTH },
      { offset: side * (crown.outer - crown.thickness), thickness: -side * CELL_DEPTH }];
    if (detail) buildShapeCourseBand(plan, stone, recipe, surface, { bottom: crown.base, top: crown.wallTop, faces,
      spans: free, domain: 'crown', key: `wall${side}:` });
    const cap = (u0, u1, y, key) => patch(stone, u0, u1, y, y + D.copingHeight, crown.outer + D.copingOverhang,
      crown.thickness + D.copingOverhang * 2, tone(key, 1.06), { bevel: detail });
    const block = (u0, u1, y0, y1, key) => {
      const pieces = Math.max(1, Math.ceil(((u1 - u0) * crown.scale) / 0.3));
      for (let k = 0; k < pieces; k++) patch(core, u0 + ((u1 - u0) * k) / pieces, u0 + ((u1 - u0) * (k + 1)) / pieces, y0, y1,
        crown.outer - CELL_PROUD, crown.thickness - CELL_PROUD * 2, detail ? joint : tone(key), { start: k === 0, end: k === pieces - 1 });
      if (detail) buildShapeCourseBand(plan, stone, recipe, surface, { bottom: y0, top: y1, faces, spans: [[u0, u1]],
        domain: 'crown', key: `${key}${side}:${Math.round(y0 * 100)}:` });
      // Dressed jamb stones close the merlon's ends, so no joint mortar shows in an embrasure.
      const jamb = 0.05 / crown.scale;
      for (const [a, b, name] of [[u0 - 0.004, u0 + jamb, 'a'], [u1 - jamb, u1 + 0.004, 'b']])
        patch(stone, a, b, y0, y1, crown.outer + 0.006, crown.thickness + 0.012, tone(`${key}:jamb-${name}`, 0.97));
    };
    // One sill course tops the crown wall under the merlons and across every embrasure.
    if (crown.merlons.length || !crown.roofed) for (const [a, b] of free) {
      const pieces = Math.max(1, Math.round(((b - a) * crown.scale) / 0.7));
      for (let k = 0; k < pieces; k++) patch(stone, a + ((b - a) * k) / pieces + 0.006, a + ((b - a) * (k + 1)) / pieces - 0.006,
        crown.wallTop - 0.07, crown.wallTop, crown.outer + 0.02, crown.thickness + 0.04, tone(`sill:${k}`, 1.03), { bevel: detail });
    }
    for (const merlon of crown.merlons) {
      if (overlaps(owned, merlon.u0, merlon.u1)) continue;
      const { u0, u1 } = merlon, top = crown.wallTop + merlon.height, width = u1 - u0;
      if (c.merlons === 'pierced' && !merlon.ruined) {
        // A loop through the merlon: two cheeks under a single top stone.
        const slit = 0.06 / crown.scale, mid = (u0 + u1) / 2, sill = crown.wallTop + merlon.height * 0.18, head = crown.wallTop + merlon.height * 0.78;
        block(u0, u1, crown.wallTop, sill, merlon.key);
        block(u0, mid - slit, sill, head, merlon.key);
        block(mid + slit, u1, sill, head, merlon.key);
        block(u0, u1, head, top, merlon.key);
      } else block(u0, u1, crown.wallTop, top, merlon.key);
      if (merlon.ruined) continue;
      if (c.merlons === 'stepped') {
        block(u0 + width * 0.25, u1 - width * 0.25, top, top + merlon.height * 0.35, `${merlon.key}:step`);
        cap(u0 + width * 0.25, u1 - width * 0.25, top + merlon.height * 0.35, `${merlon.key}:cap`);
      } else cap(u0 - 0.02, u1 + 0.02, top, `${merlon.key}:cap`);
    }
  }
}
