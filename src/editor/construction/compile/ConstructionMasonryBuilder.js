import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  beveledBox,
  harmonizeVertexColors,
} from '../../workshop/ProceduralWorkshopGeometry.js';
import { stoneJitter } from '../../workshop/ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';

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
}) {
  const stats = { stones: 0, triangles: 0 };
  if (!placements || placements.length === 0) return { meshes: [], stats };

  const style = constructionStyle(record.style.key);
  const recipe = constructionRecipe(record);
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
      beveledBox({ ...params, ...shaped, detail: style.detail }),
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
