import { Matrix3 } from 'three/webgpu';
import { floor, fract, mix, texture, uniform, vec2 } from 'three/tsl';

import { getTerrainMaterialBakeGpuState } from './TerrainMaterialBakeGpu.js';

/**
 * One terrain material shared by every terrain slot, each slot drawing its own
 * data: the texture and uniform nodes here take their value from the mesh
 * being drawn (`onObjectUpdate`), just before its bindings update.
 *
 * Why: three keys a node build by node identity, so 49 slots with 49 copies of
 * the terrain graph meant 49 builds of ~0.6 s each — at boot, and again for
 * every render path a slot first appears in (entering player mode switches to
 * the god-rays pass: a ~17 s first frame). Shared nodes share one build.
 *
 * A slot mesh carries `userData[TERRAIN_SLOT_KEY]` — its tile, height, surface
 * mask and forest floor textures, its `chunkCenter` uniform and its
 * `coastPatterns` origins — and its bake
 * GPU state (attachTerrainMaterialBakeGpuState on the mesh). The templates are
 * one slot's own, which fix texture formats at build time and stand in for a
 * mesh without slot data.
 */
export const TERRAIN_SLOT_KEY = 'terrainSlot';

function slotData(object) {
  return object?.userData?.[TERRAIN_SLOT_KEY] ?? null;
}

// Never built into a shader; see perObjectTexture.
const OBJECT_UPDATE_MARKER = uniform(new Matrix3());

/**
 * A texture node updated per drawn object. TextureNode.setup resets
 * `updateType` to NONE unless the node holds a uv-matrix uniform, which would
 * silently drop `onObjectUpdate` — every slot would keep whichever texture its
 * binding first saw. Holding a marker keeps the OBJECT update without
 * `setUpdateMatrix(true)`, which would add an identity mat3 per read: one more
 * uniform for every draw to check, and a multiply per sample.
 */
export function perObjectTexture(template, uvNode, read, node = texture(template, uvNode)) {
  node.setUpdateMatrix(false).onObjectUpdate(({ object }) => read(object) ?? template);
  node._matrixUniform = OBJECT_UPDATE_MARKER;
  return node;
}

/**
 * A texture read without a sampler: `textureLoad` at the four texels round
 * `uvNode`, filtered by hand; with `read`, per drawn object like perObjectTexture. WebGPU gives a fragment stage 16 samplers
 * however many textures it may bind, and the terrain uses every one; a smooth
 * bake read this way frees one for the path dirt (stylized/path).
 */
export function bilinearLoad(template, uvNode, read = null, transform = null) {
  const node = (coords) => {
    const load = texture(template, coords).setSampler(false);
    return read ? perObjectTexture(template, null, read, load) : load;
  };
  const size = vec2(template.image.width, template.image.height);
  const texel = uvNode.mul(size).sub(0.5);
  const base = floor(texel);
  const weight = fract(texel);
  const limit = size.sub(1);
  const load = (dx, dy) => {
    const value = node(base.add(vec2(dx, dy)).clamp(vec2(0), limit));
    return transform ? transform(value) : value;
  };
  return mix(
    mix(load(0, 0), load(1, 0), weight.x),
    mix(load(0, 1), load(1, 1), weight.x),
    weight.y,
  );
}

/** `bilinearLoad` of the drawn slot's own texture `name`, each texel decoded by `transform` before filtering. */
export function slotBilinearLoad(name, template, uvNode, transform) {
  return bilinearLoad(template, uvNode, (object) => slotData(object)?.[name], transform);
}

/** A texture node that samples the drawn slot's own texture `name`. */
export function slotTexture(name, template, uvNode) {
  return perObjectTexture(template, uvNode, (object) => slotData(object)?.[name]);
}

/** The drawn slot's texel of texture `name` holding `uvNode`, read without a sampler. */
export function slotTexel(name, template, uvNode, size) {
  const coords = floor(uvNode.mul(size)).clamp(vec2(0), vec2(size - 1));
  return perObjectTexture(template, null, (object) => slotData(object)?.[name],
    texture(template, coords).setSampler(false));
}

/** A vec2 uniform following the drawn slot's own uniform `name`. */
export function slotVector2(name, template) {
  return uniform(template.value.clone())
    .onObjectUpdate(({ object }) => slotData(object)?.[name]?.value ?? template.value);
}

/** The drawn slot's own PatternOrigins `name`, as the shared material reads it. */
export function slotPatternOrigins(name, template) {
  return template.perObject((object) => slotData(object)?.[name]);
}

/**
 * The bake GPU state as the shared material sees it: textures sampled from the
 * drawn slot's state, and its ready/stale/blend read per object. Same shape as
 * a real state for createTerrainMaterialBakedSurface, plus `sampleTexture`.
 */
export function createSlotBakeGpuState(template) {
  if (!template) return null;
  const perObject = (field) => uniform(0)
    .onObjectUpdate(({ object }) => getTerrainMaterialBakeGpuState(object)?.[field]?.value ?? 0);
  return {
    resolution: template.resolution,
    textures: template.textures,
    ready: perObject('ready'),
    stale: perObject('stale'),
    blend: perObject('blend'),
    /** As `sampleTexture`, without a sampler binding (bilinearLoad). */
    loadTexture(name, uvNode) {
      return bilinearLoad(
        template.textures[name],
        uvNode,
        (object) => getTerrainMaterialBakeGpuState(object)?.textures?.[name],
      );
    },
    sampleTexture(name, uvNode) {
      return perObjectTexture(
        template.textures[name],
        uvNode,
        (object) => getTerrainMaterialBakeGpuState(object)?.textures?.[name],
      );
    },
  };
}
