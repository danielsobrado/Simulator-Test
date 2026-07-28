/**
 * Development-only ruin support debug overlay (?constructionRuinDebug=1).
 *
 * Ghost prisms are translucent and depth-tested so they read as a coloured
 * volume over the wall without replacing production materials.
 */

import * as THREE from 'three/webgpu';
import { RUIN_REMOVAL_REASON } from '../masonry/ConstructionSupportRoles.js';
import { RUIN_DEBUG_STATE } from '../masonry/RuinDebugStates.js';

export { RUIN_DEBUG_STATE };

export const RUIN_DEBUG_COLORS = Object.freeze({
  [RUIN_DEBUG_STATE.SUPPORTED]: 0x3dba5f,
  [RUIN_DEBUG_STATE.WEAK]: 0xe6c84a,
  [RUIN_DEBUG_STATE.PRELIMINARY]: 0xe67a22,
  [RUIN_DEBUG_STATE.UNSUPPORTED]: 0xd64545,
  [RUIN_DEBUG_STATE.ARCH]: 0x8e44ad,
  [RUIN_DEBUG_STATE.FOOTING]: 0x3498db,
  [RUIN_DEBUG_STATE.CROSS_MODULE]: 0x1abc9c,
});

export function isConstructionRuinDebugEnabled(search = '') {
  const value = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(value.startsWith('?') ? value.slice(1) : value);
  return params.get('constructionRuinDebug') === '1';
}

export function ruinDebugStateForRemoval(reason) {
  if (reason === RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED) return RUIN_DEBUG_STATE.ARCH;
  if (
    reason === RUIN_REMOVAL_REASON.CLUSTER_DAMAGE
    || reason === RUIN_REMOVAL_REASON.MACRO_CLIP
    || reason === RUIN_REMOVAL_REASON.ABOVE_ENVELOPE
  ) {
    return RUIN_DEBUG_STATE.PRELIMINARY;
  }
  return RUIN_DEBUG_STATE.UNSUPPORTED;
}

function materialFor(state) {
  const color = RUIN_DEBUG_COLORS[state] ?? RUIN_DEBUG_COLORS[RUIN_DEBUG_STATE.UNSUPPORTED];
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    depthTest: true,
  });
}

function ghostFromRecord(record, {
  arcTable,
  origin,
  groundHeightAt,
  state,
}) {
  const frame = arcTable.frameAt(record.s);
  const ground = groundHeightAt?.(frame.x, frame.z) ?? 0;
  const width = Math.max(0.08, record.width ?? (record.span?.[1] - record.span?.[0]) ?? 0.25);
  const height = Math.max(0.08, record.height ?? 0.25);
  const depth = Math.max(0.08, record.depth ?? 0.4);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(geometry, materialFor(state));
  mesh.position.set(
    frame.x - origin.x,
    ground + (record.y ?? (record.bottom + record.top) * 0.5),
    frame.z - origin.z,
  );
  const yaw = Math.atan2(frame.tangentX, frame.tangentZ);
  mesh.rotation.y = yaw;
  mesh.name = `construction-ruin-debug:${record.stableIndex ?? 'x'}:${state}`;
  mesh.userData.ruinDebug = true;
  mesh.userData.ruinDebugState = state;
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * Build ghost meshes for survivor + removal diagnostics.
 */
export function buildRuinDebugMeshes({
  survivors = [],
  removals = [],
  arcTable,
  origin,
  groundHeightAt,
}) {
  if (!arcTable) return [];
  const meshes = [];
  for (const record of survivors) {
    meshes.push(ghostFromRecord(record, {
      arcTable,
      origin,
      groundHeightAt,
      state: record.debugState ?? RUIN_DEBUG_STATE.SUPPORTED,
    }));
  }
  for (const entry of removals) {
    const placement = entry.placement ?? entry;
    const reason = entry.reason ?? placement.reason;
    meshes.push(ghostFromRecord({
      stableIndex: placement.stableIndex,
      s: placement.s,
      y: placement.y,
      width: placement.width ?? placement.packedWidth,
      height: placement.height,
      depth: placement.depth ?? 0.45,
      span: placement.support?.span,
      bottom: placement.support?.bottom,
      top: placement.support?.top,
    }, {
      arcTable,
      origin,
      groundHeightAt,
      state: ruinDebugStateForRemoval(reason),
    }));
  }
  return meshes;
}

export function disposeRuinDebugMeshes(meshes) {
  for (const mesh of meshes ?? []) {
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
}
