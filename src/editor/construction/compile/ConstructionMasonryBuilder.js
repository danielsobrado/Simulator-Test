import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  beveledBox,
  beveledQuadPrism,
  harmonizeVertexColors,
} from '../../workshop/ProceduralWorkshopGeometry.js';
import { stoneJitter } from '../../workshop/ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { scaleCorners } from '../masonry/CourseLattice.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../render/ConstructionMaterialSlots.js';
import {
  CONSTRUCTION_MORTAR_CONFIG,
  overlapForCategory,
} from '../render/ConstructionMortarConfig.js';
import {
  buildMortarCoreGeometry,
  expandCorners,
  mortarCoreDepth,
} from './ConstructionMortarCoreBuilder.js';

/**
 * Turn module-local stone placements into merged geometry.
 *
 * Runs on the main thread: the packer produces plain data in a worker, and this
 * is where Three.js enters (doc 18 invariant 6). Geometry is emitted in
 * **module-origin-local** space so a floating-origin rebase stays a transform
 * update, and so bevels and mortar insets sit in a well-conditioned float32
 * range instead of being quantised away 3 km from the origin.
 *
 * Each module returns a mortar mesh (recessed core) then a stone mesh. The
 * authoritative construction record is unchanged; mortar is derived geometry.
 */

/**
 * How much of `stoneJitter`'s in-plane shaping a lattice stone keeps.
 *
 * A packed box is an island: resizing it ±10% or rolling it a couple of degrees
 * just varies the stone, because the mortar gap around it was never meant to
 * close. A lattice stone is the opposite — it is cut to *share* its corners with
 * its neighbours, and the same ±10% would open holes several times the width of
 * the joint. Damped to roughly the size of the mortar inset, the jitter still
 * reads as hand-laid without unpicking the bond.
 *
 * Out-of-plane shaping (rotation X/Y, protrusion, depth) is left at full
 * strength: it is the strongest silhouette cue in the wall and it cannot open an
 * in-plane joint.
 */
const LATTICE_SHAPE_DAMPING = 0.25;
const LATTICE_ROLL_DAMPING = 0.3;

/**
 * Construction stones carry a wider bevel than the workshop default.
 *
 * The reference gets its pillowy read from subdividing every extruded polygon.
 * The equivalent here is the bevel ring, which `05-…md` §5 explicitly allows to
 * be exaggerated for readability at game scale. Applied as a gain rather than a
 * fixed value so `stoneJitter`'s per-stone bevel variation survives, and capped
 * so a stone never rounds off into a pebble.
 */
const LATTICE_BEVEL_GAIN = 1.4;
const LATTICE_BEVEL_MAX = 0.16;

export function constructionRecipe(record) {
  const style = constructionStyle(record.style.key);
  return Object.freeze({
    seed: record.seed,
    irregularity: style.irregularity,
    detail: style.detail,
    style: style.stonePalette,
    topStyle: 'slate',
    weathering: 0.25,
    albedo: null,
  });
}

/** `stoneJitter`'s width and height scaling, damped and applied to the face ring. */
function dampedCorners(placement, shaped) {
  const damp = (jittered, nominal) => (
    1 + ((jittered / nominal) - 1) * LATTICE_SHAPE_DAMPING
  );
  return scaleCorners(
    placement.corners,
    damp(shaped.width, placement.width),
    damp(shaped.height, placement.height),
  );
}

/** Roll turns in the face plane and can open a joint; the other two cannot. */
function dampedRotation(nominal, jittered) {
  return [
    jittered[0],
    jittered[1],
    nominal[2] + (jittered[2] - nominal[2]) * LATTICE_ROLL_DAMPING,
  ];
}

/** Axis-aligned face ring for ordinary (non-lattice) box stones. */
export function rectangleCorners(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

/**
 * Resolve the final stone shape once, after jitter, so visible stone and mortar
 * backing cannot disagree.
 */
export function resolveStoneShape({ placement, params, shaped, detail }) {
  const lattice = Boolean(placement.corners);
  const corners = lattice
    ? dampedCorners(placement, shaped)
    : rectangleCorners(shaped.width, shaped.height);
  const rotation = lattice
    ? dampedRotation(params.rotation, shaped.rotation)
    : shaped.rotation;
  return {
    corners,
    width: shaped.width,
    height: shaped.height,
    depth: shaped.depth,
    position: shaped.position,
    rotation,
    category: placement.category ?? 'field',
    bevelRatio: lattice
      ? Math.min(LATTICE_BEVEL_MAX, shaped.bevelRatio * LATTICE_BEVEL_GAIN)
      : shaped.bevelRatio,
    skew: shaped.skew,
    protrusion: shaped.protrusion,
    lattice,
    detail,
  };
}

export function shouldBuildMortarBacking(placement) {
  return placement?.category !== 'recess';
}

/**
 * Face ring for the recessed mortar core.
 *
 * Prefer the packer's solved `mortarCorners` (full cell footprint) with only a
 * millimetre-scale safety overlap. Fall back to expanding the final stone face
 * for dressings / legacy placements that omit the footprint.
 */
function mortarFaceCorners({ placement, stoneShape, config }) {
  if (placement.mortarCorners) {
    return expandCorners(
      placement.mortarCorners,
      config.safetyOverlap,
      { maxScale: config.maxCornerScale },
    );
  }

  const overlap = overlapForCategory(
    placement.category ?? stoneShape.category,
    config,
  );
  return expandCorners(
    stoneShape.corners,
    overlap,
    { maxScale: config.maxCornerScale },
  );
}

/**
 * Plain-data mortar prism for one resolved stone.
 *
 * @returns {object | null}
 */
export function createMortarDescriptor({
  placement,
  stoneShape,
  config = CONSTRUCTION_MORTAR_CONFIG,
}) {
  if (!shouldBuildMortarBacking(placement)) return null;

  const sourceCorners = placement.mortarCorners ?? stoneShape.corners;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of sourceCorners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const stoneWidth = maxX - minX;
  const stoneHeight = maxY - minY;
  if (!(stoneWidth > 0) || !(stoneHeight > 0)) return null;

  const mortarCorners = mortarFaceCorners({
    placement,
    stoneShape,
    config,
  });
  const depth = mortarCoreDepth(stoneShape.depth, config);

  return {
    corners: mortarCorners,
    depth,
    position: stoneShape.position,
    rotation: stoneShape.rotation,
    uvDensity: config.uvDensity,
  };
}

function createStoneGeometry(stoneShape) {
  if (stoneShape.lattice) {
    return beveledQuadPrism({
      corners: stoneShape.corners,
      depth: stoneShape.depth,
      position: stoneShape.position,
      rotation: stoneShape.rotation,
      bevelRatio: stoneShape.bevelRatio,
      detail: stoneShape.detail,
    });
  }
  return beveledBox({
    width: stoneShape.width,
    height: stoneShape.height,
    depth: stoneShape.depth,
    position: stoneShape.position,
    rotation: stoneShape.rotation,
    bevelRatio: stoneShape.bevelRatio,
    skew: stoneShape.skew,
    detail: stoneShape.detail,
  });
}

function emptyStats() {
  return {
    stones: 0,
    stoneTriangles: 0,
    mortarPrisms: 0,
    mortarTriangles: 0,
    totalTriangles: 0,
    stoneBuildMs: 0,
    mortarBuildMs: 0,
    // Legacy alias used by older call sites / counters.
    triangles: 0,
  };
}

/**
 * @param placements from `packCurvedWall`, module-local.
 * @param options.moduleOrigin canonical XZ the emitted vertices are relative to.
 * @param options.groundHeightAt `(canonicalX, canonicalZ) => number`. Courses are
 *   solved relative to grade, so the packer never needs terrain and none has to
 *   cross into the worker; ground is resolved here, on the main thread.
 */
export function buildModuleMasonry(placements, {
  record,
  materials,
  arcTable,
  moduleOrigin,
  groundHeightAt,
  lodBand = 'near',
  mortarConfig = CONSTRUCTION_MORTAR_CONFIG,
}) {
  const stats = emptyStats();
  if (!placements || placements.length === 0) return { meshes: [], stats };

  const style = constructionStyle(record.style.key);
  const coarse = lodBand === 'coarse';
  // Coarse: detail 1, halved jitter. Dressings stay in the placement list; the
  // caller thins field courses before we get here.
  const detail = coarse ? 1 : style.detail;
  const recipe = Object.freeze({
    ...constructionRecipe(record),
    detail,
    irregularity: coarse ? style.irregularity * 0.5 : style.irregularity,
  });

  const stoneGeometries = [];
  const mortarDescriptors = [];
  const stoneStarted = performance.now();

  for (const placement of placements) {
    const frame = arcTable.frameAt(placement.s);
    const canonicalX = frame.x + frame.normalX * placement.offsetNormal;
    const canonicalZ = frame.z + frame.normalZ * placement.offsetNormal;
    const params = {
      width: placement.width,
      height: placement.height,
      depth: placement.depth,
      position: [
        canonicalX - moduleOrigin.x,
        groundHeightAt(canonicalX, canonicalZ) + placement.y,
        canonicalZ - moduleOrigin.z,
      ],
      // `[0, yaw, roll]` and no other order. `transformGeometry` builds
      // `new THREE.Euler(...rotation)` with the default 'XYZ' order, composing
      // R = Rx*Ry*Rz — so the Z roll applies first in the block's own frame and
      // the Y yaw then swings it onto the path. Swapping these tilts every
      // coping stone sideways in a way that looks almost right.
      rotation: [0, frame.yaw, placement.roll],
    };
    const shaped = stoneJitter(recipe, params, placement.stableIndex, placement.category);
    const stoneShape = resolveStoneShape({ placement, params, shaped, detail });
    stoneGeometries.push(applyUnitShading(
      createStoneGeometry(stoneShape),
      recipe,
      {
        stableIndex: placement.stableIndex,
        heightRatio: placement.heightRatio,
        protrusion: stoneShape.protrusion,
        depth: stoneShape.depth,
      },
    ));
    const mortarDescriptor = createMortarDescriptor({
      placement,
      stoneShape,
      config: mortarConfig,
    });
    if (mortarDescriptor) mortarDescriptors.push(mortarDescriptor);
  }
  stats.stoneBuildMs = performance.now() - stoneStarted;

  // The stone material declares `vertexColors`, and a material that reads
  // vertex colours from a geometry that has none renders black. `required`
  // covers the case where nothing in this module happened to be shaded.
  harmonizeVertexColors(stoneGeometries, { required: true });

  let mergedStone = null;
  let mortarCore = null;
  let mortarMesh = null;
  let stoneMesh = null;
  try {
    mergedStone = mergeGeometries(stoneGeometries);
    if (!mergedStone) {
      return { meshes: [], stats };
    }
    mergedStone.computeBoundingBox();
    mergedStone.computeBoundingSphere();

    const mortarStarted = performance.now();
    mortarCore = buildMortarCoreGeometry(mortarDescriptors);
    stats.mortarBuildMs = performance.now() - mortarStarted;

    stats.stones = placements.length;
    stats.stoneTriangles = (mergedStone.index?.count ?? mergedStone.attributes.position.count) / 3;
    stats.mortarPrisms = mortarDescriptors.length;
    stats.mortarTriangles = mortarCore
      ? (mortarCore.index?.count ?? mortarCore.attributes.position.count) / 3
      : 0;
    stats.totalTriangles = stats.stoneTriangles + stats.mortarTriangles;
    stats.triangles = stats.totalTriangles;

    const meshes = [];
    if (mortarCore) {
      mortarMesh = new THREE.Mesh(mortarCore, materials.mortar);
      mortarMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
      mortarMesh.castShadow = false;
      mortarMesh.receiveShadow = true;
      meshes.push(mortarMesh);
      mortarCore = null;
    }

    stoneMesh = new THREE.Mesh(mergedStone, materials.stone);
    stoneMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    meshes.push(stoneMesh);
    mergedStone = null;
    mortarMesh = null;
    stoneMesh = null;

    return { meshes, stats };
  } catch (error) {
    mergedStone?.dispose();
    mortarCore?.dispose();
    mortarMesh?.geometry?.dispose();
    stoneMesh?.geometry?.dispose();
    throw error;
  } finally {
    for (const geometry of stoneGeometries) {
      geometry.dispose();
    }
  }
}
