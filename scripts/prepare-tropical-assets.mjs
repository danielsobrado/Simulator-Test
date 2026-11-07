/**
 * Canonical runtime sources for the light half of the tropical ground kit.
 *
 * The runtime optimizer (`scripts/optimize-runtime-assets.mjs`) runs every
 * configured source through gltfpack and then asserts that the two have the
 * same rendered triangle count — simplification is deliberately never enabled,
 * so the optimizer may not change what an authored asset looks like. gltfpack
 * always welds vertices and, while doing so, drops the zero-area triangles that
 * a tapered blade leaves behind where its two tip vertices coincide. Those two
 * operations together change the count
 * (`/assets/ground/tropical/jungle-grass-short.glb: rendered triangle count
 * changed from 1760 to 1540; simplification is not enabled.`).
 *
 * The fix belongs upstream, in the canonical source: weld bitwise-identical
 * vertices (gltf-transform's `weld`) and remove the degenerate triangles here,
 * so gltfpack has nothing left to drop and the authored count it is handed
 * already equals the count it would emit. Nothing else is touched — no
 * simplification, no decimation, no bounds change, no material or primitive
 * reassignment.
 *
 * The donor is `grass-test/public/Assets/terrain/coastal-jungle/objects/tropical-kit`;
 * the ten files below are its light half. The heavy half (palm_young,
 * palm_tall, jungle_canopy_tree, fern_small, fern_large, hanging_vine_cluster)
 * is deliberately excluded. The canonical sources are the already-staged copies
 * under `assets/runtime-sources/ground/tropical/`; this script reads and rewrites
 * them in place, and is idempotent — a second run removes nothing and writes the
 * same bytes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { readGlbJson, renderedTriangleCount } from './lib/glb-inspection.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = 'assets/runtime-sources/ground/tropical';
const donorDirectory = 'public/Assets/terrain/coastal-jungle/objects/tropical-kit';

/** The light half of the tropical kit, as staged under `sourceDirectory`. */
const TROPICAL_ASSETS = Object.freeze([
  'jungle-grass-short',
  'jungle-grass-tall',
  'jungle-grass-broad',
  'jungle-groundcover',
  'elephant-ear',
  'banana-understory',
  'broad-leaf-module',
  'fern-frond-module',
  'palm-frond-module',
  'vine-strand-module',
]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      const mode = primitive.getMode();
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }
  return triangles;
}

function vertexCount(document) {
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0;
    }
  }
  return vertices;
}

/**
 * Removes degenerate triangles — those with a repeated vertex index, and those
 * whose three positions are collinear (zero area). gltfpack would drop exactly
 * these, so removing them here keeps the authored count equal to gltfpack's.
 * Positions and every other vertex attribute are left untouched.
 */
function dropDegenerateTriangles(document) {
  let removed = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      const vertexCountValue = position.getCount();
      const source = indices ? indices.getArray() : null;
      const indexCount = indices ? indices.getCount() : vertexCountValue;
      const at = (index) => (source ? source[index] : index);
      const positions = [];
      for (let index = 0; index < vertexCountValue; index += 1) {
        positions.push(position.getElement(index, []));
      }
      const kept = [];
      for (let triangle = 0; triangle < indexCount; triangle += 3) {
        const a = at(triangle);
        const b = at(triangle + 1);
        const c = at(triangle + 2);
        if (a === b || b === c || a === c) {
          removed += 1;
          continue;
        }
        const pa = positions[a];
        const pb = positions[b];
        const pc = positions[c];
        const ux = pb[0] - pa[0];
        const uy = pb[1] - pa[1];
        const uz = pb[2] - pa[2];
        const vx = pc[0] - pa[0];
        const vy = pc[1] - pa[1];
        const vz = pc[2] - pa[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx === 0 && ny === 0 && nz === 0) {
          removed += 1;
          continue;
        }
        kept.push(a, b, c);
      }
      if (kept.length === indexCount) continue;
      if (kept.length === 0) {
        throw new Error(
          `${primitive.getMaterial()?.getName() ?? 'primitive'}: every triangle is degenerate.`,
        );
      }
      const componentType = indices?.getComponentType() ?? 5125;
      const ArrayType = componentType === 5125
        ? Uint32Array
        : (componentType === 5123 ? Uint16Array : Uint8Array);
      const accessor = indices ?? document.createAccessor();
      accessor.setType('SCALAR');
      accessor.setArray(new ArrayType(kept));
      if (!indices) primitive.setIndices(accessor);
    }
  }
  return removed;
}

/**
 * `dedup` lets two primitives with identical topology share one index accessor.
 * gltfpack always writes one index buffer per primitive, so a shared accessor
 * makes the optimizer's "logical geometry never grows" check fail
 * (banana-understory). Giving each primitive its own copy states the source the
 * way gltfpack will emit it; the rendered geometry is unchanged.
 */
function unshareIndices(document) {
  const seen = new Set();
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      if (!indices) continue;
      if (seen.has(indices)) primitive.setIndices(indices.clone());
      else seen.add(indices);
    }
  }
}

function replaceFileAtomically(bytes, targetPath) {
  const temporaryPath = `${targetPath}.prepare-${process.pid}.tmp`;
  const displacedPath = `${targetPath}.prepare-${process.pid}.previous`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporaryPath, bytes);
  const displaced = fs.existsSync(targetPath);
  try {
    if (displaced) fs.renameSync(targetPath, displacedPath);
    fs.renameSync(temporaryPath, targetPath);
    fs.rmSync(displacedPath, { force: true });
  } catch (error) {
    if (displaced && fs.existsSync(displacedPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(displacedPath, targetPath);
    }
    throw error;
  } finally {
    fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(displacedPath, { force: true });
  }
}

const records = [];

// Phase 1 — read, clean and validate every asset. Nothing is written until all
// ten have succeeded, so a failure never leaves a half-prepared library behind.
for (const name of TROPICAL_ASSETS) {
  const relativePath = `${sourceDirectory}/${name}.glb`;
  const sourcePath = path.join(rootDir, relativePath);
  const donorFile = `${name.replaceAll('-', '_')}.glb`;
  let stage = 'read';
  try {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`canonical source is missing`);
    }
    const inputBytes = fs.readFileSync(sourcePath);
    const inputJson = readGlbJson(inputBytes, relativePath);
    const beforeTriangles = renderedTriangleCount(inputJson);

    stage = 'clean';
    const document = await io.read(sourcePath);
    const root = document.getRoot();
    const beforeVertices = vertexCount(document);
    const removed = dropDegenerateTriangles(document);
    await document.transform(
      weld(),
      dedup(),
      prune(),
    );
    unshareIndices(document);
    const afterTriangles = triangleCount(document);
    const afterVertices = vertexCount(document);
    // The invariant that can actually be proved is that nothing grew. An exact
    // match against this script's own pre-count cannot be: `weld` merges vertices
    // that were only coincident to float precision, which turns further triangles
    // degenerate, and `prune` then drops their geometry. So the count may fall by
    // more than this script removed, and the honest check is that it never rises —
    // which is also the contract the runtime optimizer re-checks after us.
    if (afterTriangles > beforeTriangles) {
      throw new Error(
        `triangle count grew during cleaning: ${beforeTriangles} -> ${afterTriangles}`,
      );
    }
    const removedByGeometry = beforeTriangles - afterTriangles;
    const removedByWelding = removedByGeometry - removed;

    const sourceExtras = root.getAsset().extras ?? {};
    root.getAsset().generator = 'SimCity-DnD tropical asset preparer';
    root.getAsset().extras = {
      ...sourceExtras,
      preparedFrom: `${donorDirectory}/${donorFile}`,
      runtimeAsset: name,
      preparer: 'scripts/prepare-tropical-assets.mjs',
      degeneratetrianglesRemoved: removed,
      trianglesRemoved: removedByGeometry,
      // Split so the number is explicable later: this script's own pass, and the
      // extra that welding coincident vertices turned degenerate.
      trianglesRemovedByWelding: removedByWelding,
    };

    stage = 'write';
    const outputBytes = await io.writeBinary(document);
    const outputJson = readGlbJson(Buffer.from(outputBytes), relativePath);
    const writtenTriangles = renderedTriangleCount(outputJson);
    if (writtenTriangles !== afterTriangles) {
      throw new Error(
        `written triangle count ${writtenTriangles} does not match prepared ${afterTriangles}`,
      );
    }

    records.push({
      name,
      relativePath,
      beforeTriangles,
      afterTriangles,
      removed,
      beforeVertices,
      afterVertices,
      beforeBytes: inputBytes.length,
      outputBytes,
      inputSha256: hash(inputBytes),
      outputSha256: hash(outputBytes),
    });
  } catch (error) {
    throw new Error(`${relativePath}: ${stage} failed: ${error.message}`);
  }
}

// Phase 2 — write every cleaned asset back to its canonical path.
for (const record of records) {
  replaceFileAtomically(record.outputBytes, path.join(rootDir, record.relativePath));
}

for (const record of records) {
  console.log(
    `${record.name}: ${record.beforeTriangles} -> ${record.afterTriangles} triangles `
    + `(${record.removed} degenerate removed), `
    + `${(record.beforeBytes / 1024).toFixed(1)} -> ${(record.outputBytes.length / 1024).toFixed(1)} KiB`,
  );
}

const columns = [
  ['asset', 22],
  ['before', 8],
  ['after', 8],
  ['removed', 8],
  ['KiB before', 11],
  ['KiB after', 10],
];
console.log('');
console.log(columns.map(([title, width]) => title.padEnd(width)).join('  '));
console.log(columns.map(([, width]) => '-'.repeat(width)).join('  '));
for (const record of records) {
  console.log([
    record.name.padEnd(22),
    String(record.beforeTriangles).padEnd(8),
    String(record.afterTriangles).padEnd(8),
    String(record.removed).padEnd(8),
    (record.beforeBytes / 1024).toFixed(1).padEnd(11),
    (record.outputBytes.length / 1024).toFixed(1).padEnd(10),
  ].join('  '));
}
const totals = records.reduce(
  (sum, record) => ({
    beforeTriangles: sum.beforeTriangles + record.beforeTriangles,
    afterTriangles: sum.afterTriangles + record.afterTriangles,
    removed: sum.removed + record.removed,
  }),
  { beforeTriangles: 0, afterTriangles: 0, removed: 0 },
);
console.log(
  `prepared ${records.length} tropical sources: `
  + `${totals.beforeTriangles} -> ${totals.afterTriangles} triangles `
  + `(${totals.removed} degenerate removed)`,
);
