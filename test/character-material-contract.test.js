import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const materialsDir = new URL('../src/editor/character/materials/', import.meta.url);
const files = (await readdir(materialsDir)).filter((name) => name.endsWith('.js'));
const sources = new Map(
  await Promise.all(files.map(async (name) => [
    name,
    await readFile(new URL(name, materialsDir), 'utf8'),
  ])),
);

const source = (name) => {
  const text = sources.get(name);
  assert.ok(text, `${name} is missing`);
  return text;
};

/**
 * Comments explain *why* these nodes are banned and so name them; the ban is on
 * the code. Strip prose before scanning or the doc comment trips its own test.
 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('nothing on the character samples a viewport texture', () => {
  // These are whole-frame costs a mesh pays merely by having them compiled into
  // its material: sampling either makes the renderer copy the colour buffer,
  // copy the depth buffer and build a mip chain for the entire frame. The cost
  // is binary and not avoidable by culling or by `visible = false` — measured,
  // one such mesh costs the same as forty. See CLAUDE.md and
  // docs/perf-investigation-2026-07-28.md.
  //
  // The character is on screen only in walk mode, so it must never levy one.
  for (const [name, raw] of sources) {
    const text = stripComments(raw);
    assert.doesNotMatch(text, /viewportDepthTexture/, `${name} samples the depth buffer`);
    assert.doesNotMatch(text, /viewportOpaqueMipTexture/, `${name} samples the opaque mip chain`);
    assert.doesNotMatch(text, /viewportTexture/, `${name} samples the viewport`);
  }
});

test('the transform texture is read with integer fetches, never filtered', () => {
  // Float textures are not filterable without a feature flag, and every read
  // here is an exact texel anyway — a bone matrix column or a cloth node.
  for (const name of ['characterSkinNodes.js', 'clothSurfaceNodes.js']) {
    const text = source(name);
    assert.match(text, /textureLoad\(/, `${name} should fetch texels`);
    assert.doesNotMatch(
      text,
      /\btexture\(\s*transformTexture/,
      `${name} must not sample the transform texture with a sampler`,
    );
  }
});

test('the body and the garments differ only in where their vertices come from', () => {
  const text = source('createDrowMaterials.js');
  // Both build their surface from the same fabric node factory.
  assert.equal((text.match(/createDrowFabricNodes\(/g) ?? []).length, 2);
  assert.match(text, /material\.positionNode = skin\.position\(positionLocal\)/);
  assert.match(text, /material\.positionNode = surface\.position/);
});

test('skinned meshes skin their normals too', () => {
  // `positionNode` replaces the position outright, so a normal left in bind pose
  // detaches the lighting from the pose — the drow would be lit as though it
  // were standing in T-pose at the origin however it was actually moving.
  const text = source('createDrowMaterials.js');
  const body = text.match(/export function createDrowBodyMaterial[\s\S]*?\n\}/)[0];
  const fur = text.match(/export function createDrowFurMaterial[\s\S]*?\n\}/)[0];
  for (const [name, chunk] of [['body', body], ['fur', fur]]) {
    assert.match(chunk, /positionNode = skin\.position/, `${name} must skin its position`);
    assert.match(chunk, /normalNode = skin\.normal/, `${name} must skin its normal`);
  }
});

test('the garment surface reconstruction is bicubic, not bilinear', () => {
  // The robe's nine pleats are authored into the rest shape at four grid samples
  // each. Reconstructed linearly they come out as a faceted zigzag, and the fold
  // count was chosen precisely because Catmull-Rom turns four samples per fold
  // into a clean wave.
  const text = source('clothSurfaceNodes.js');
  assert.match(text, /function catmull\(/);
  assert.match(text, /function catmullDerivative\(/);
  // Four rows of four control points.
  assert.match(text, /for \(let r = -1; r <= 2; r\+\+\)/);
  assert.match(text, /node\(iu\.sub\(int\(1\)\), row\)/);
  assert.match(text, /node\(iu\.add\(int\(2\)\), row\)/);
});

test('the garment tube wraps in U and clamps in V', () => {
  // Every panel is a closed tube. Clamping U instead would put a crease down the
  // front of the robe where the seam failed to interpolate through itself.
  const text = source('clothSurfaceNodes.js');
  assert.match(text, /const c = col\.add\(cols\)\.mod\(cols\);/);
  assert.match(text, /clamp\(row, int\(0\), rows\.sub\(1\)\)/);
});

test('the weave fades out before it can alias', () => {
  const text = source('drowFabricNodes.js');
  assert.match(text, /fwidth\(weaveUv\)/);
  assert.match(text, /weaveFade/);
});

test('the hair streak is an explicit lobe, not three.js anisotropy', () => {
  // three.js's `anisotropy` input needs a tangent frame built from a `position`
  // attribute; on the garment mesh `position` is a panel parameter, not a
  // location, so there is nothing to derive tangents from.
  const text = source('drowFabricNodes.js');
  assert.match(text, /function hairStreak\(\)/);
  assert.doesNotMatch(text, /anisotropyNode/);
  const materials = source('createDrowMaterials.js');
  assert.doesNotMatch(materials, /anisotropyNode/);
  assert.match(materials, /emissiveNode\.add\(fabric\.hairStreak\(\)\)/);
});

test('the palette is uploaded as uniforms, not folded into the graph', () => {
  const text = source('drowFabricNodes.js');
  assert.equal((text.match(/uniformArray\(/g) ?? []).length, 3);
  assert.match(text, /albedoArray\.element\(slot\)/);
});
