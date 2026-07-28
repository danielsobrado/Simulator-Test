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

/**
 * Turn module-local stone placements into merged geometry.
 *
 * Runs on the main thread: the packer produces plain data in a worker, and this
 * is where Three.js enters (doc 18 invariant 6). Geometry is emitted in
 * **module-origin-local** space so a floating-origin rebase stays a transform
 * update, and so bevels and mortar insets sit in a well-conditioned float32
 * range instead of being quantised away 3 km from the origin.
 */

/**
 * `stoneJitter` and `applyUnitShading` both expect a workshop recipe. Rather
 * than drag that schema across, adapt the construction record to the fields
 * they actually read.
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
}) {
  const stats = { stones: 0, triangles: 0 };
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
  const geometries = [];

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
    geometries.push(applyUnitShading(
      placement.corners
        ? beveledQuadPrism({
          ...params,
          ...shaped,
          corners: dampedCorners(placement, shaped),
          rotation: dampedRotation(params.rotation, shaped.rotation),
          bevelRatio: Math.min(LATTICE_BEVEL_MAX, shaped.bevelRatio * LATTICE_BEVEL_GAIN),
          detail,
        })
        : beveledBox({ ...params, ...shaped, detail }),
      recipe,
      {
        stableIndex: placement.stableIndex,
        heightRatio: placement.heightRatio,
        protrusion: shaped.protrusion,
        depth: shaped.depth,
      },
    ));
  }

  // The stone material declares `vertexColors`, and a material that reads
  // vertex colours from a geometry that has none renders black. `required`
  // covers the case where nothing in this module happened to be shaded.
  harmonizeVertexColors(geometries, { required: true });
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) return { meshes: [], stats };

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  stats.stones = placements.length;
  stats.triangles = (merged.index?.count ?? merged.attributes.position.count) / 3;

  const mesh = new THREE.Mesh(merged, materials.stone);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { meshes: [mesh], stats };
}
