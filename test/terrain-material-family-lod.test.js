import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { createTerrainMaterialBakeConfig } from '../src/editor/materials/TerrainMaterialBakeConfig.js';

/**
 * Source-text assertions read a canonical view of the source: whitespace runs
 * collapse to one space, then whitespace around brackets, commas, semicolons and
 * member access is dropped. Any indentation, re-wrapping or formatter run
 * produces the same string, so a reformat can never break a test - and the
 * patterns still read like the code they assert on.
 */
function canonical(source) {
  return source
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[\]{},;])\s*/g, '$1')
    .replace(/\s*\.\s*/g, '.');
}

function readSource(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

/** The canonical body of a top-level `function name(...) { ... }`. */
function body(source, name) {
  const text = canonical(source);
  const signature = `function ${name}(`;
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `expected a ${name} function`);
  const open = text.indexOf('){', start + signature.length);
  assert.ok(open >= 0, `expected a ${name} body`);
  const from = open + 1;
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, index);
    }
  }
  throw new Error(`Unterminated ${name} function.`);
}

/** A numeric module constant, read from the module so it cannot drift silently. */
function moduleConstant(source, name) {
  const match = new RegExp(`const ${name} = ([0-9.]+);`).exec(canonical(source));
  assert.ok(match, `expected a ${name} module constant`);
  return Number(match[1]);
}

function familiesConfig() {
  const document = yaml.load(readSource('../config/terrain-material-bake.yaml'));
  return createTerrainMaterialBakeConfig(document).families;
}

// Every source is held in its canonical (formatting-insensitive) form, so an
// assertion can never be broken by indentation or line wrapping.
const stochasticSource = canonical(
  readSource('../src/editor/materials/TerrainMaterialStochasticNodes.js'),
);
const bakedSource = canonical(
  readSource('../src/editor/materials/TerrainMaterialBakedNodes.js'),
);
const terrainSource = canonical(readSource('../src/editor/terrainMaterial.js'));
const terrainViewSource = canonical(readSource('../src/editor/InfiniteTerrainView.js'));

test('stochastic terrain sampling uses triangular array-texture variants without hard cell seams', () => {
  const triSample = body(stochasticSource, 'stochasticTriSample');
  assert.match(triSample, /const upper = sum\.greaterThan\(1\);/);
  // The triangular sampler taps the shared atlas once per triangle vertex and
  // scales each tap by that vertex's barycentric weight.
  assert.equal((triSample.match(/sampleVariant\(/g) ?? []).length, 3);
  assert.equal((triSample.match(/\)\.mul\(weight[012]\)/g) ?? []).length, 3);
  assert.match(triSample, /const vertex0 = select\(upper,cell\.add\(vec2\(1,1\)\),cell\);/);
  assert.match(triSample, /const vertex1 = cell\.add\(vec2\(1,0\)\);/);
  assert.match(triSample, /const vertex2 = cell\.add\(vec2\(0,1\)\);/);

  const variant = body(stochasticSource, 'sampleVariant');
  assert.match(variant, /texture\(atlas,sampleUv\)\.depth\(layer\)\.rgb/);
  assert.match(variant, /const scaleHash = hash2\(vertex,HASH_VECTOR_B,71\.3\);/);
  assert.match(variant, /baseUv\.mul\(scale\)\.add\(vec2\(shiftX,shiftY\)\)/);
  assert.match(variant, /rotateQuarterTurns/);
  assert.match(variant, /mirrorHash\.greaterThan\(0\.5\)/);
  // No hard-coded variants: the jitter hashes have to stay per-vertex.
  assert.doesNotMatch(stochasticSource, /scaleJitter,(17|37)/);
});

test('family projection consumes baked shape as a colour multiplier only, while lighting normals come from the baked surface gradient', () => {
  const projection = body(stochasticSource, 'createTerrainMaterialFamilyMultiplier');
  assert.match(projection, /families\.projection\.slopeStart/);
  assert.match(projection, /families\.projection\.slopeFull/);
  assert.match(projection, /abs\(farNormal\.r\)\.greaterThan\(abs\(farNormal\.g\)\)/);
  assert.match(projection, /terrainHeight\.mul\(families\.projection\.verticalScale\)/);
  // The family module's only output is a 1-centred colour multiplier: it never
  // produces and never assigns a lighting normal.
  assert.match(projection, /return mix\(vec3\(1\),projected,strength\);/);
  assert.doesNotMatch(stochasticSource, /normalNode/);

  // Supersedes `docs/perf-qa.md` "Terrain normal and forest-floor/dirt layering
  // (2026-07-26)". That note flagged assigning `normalNode` while it was a
  // literal local +Z; 318ac383/457b5179 deliberately re-introduced the
  // assignment as a computed surface gradient that shares the geometry's
  // heightfield, gated on bake readiness. Encode that current intent.
  assert.match(
    bakedSource,
    /createTerrainSurfaceNormal\(\{encodedNormal: samples\.farNormal,/,
  );
  assert.match(bakedSource, /normal: readyNormal,/);
  assert.match(terrainSource, /material\.normalNode = footprints\.relief\(bakedSurface\.normal\);/);
  assert.doesNotMatch(terrainSource, /material\.normalNode = vec3\(/);
});

test('micro detail fades before it undersamples while mip-filtered meso detail survives', () => {
  assert.match(stochasticSource, /families\.microFadeStartDistance/);
  assert.match(stochasticSource, /families\.microFadeEndDistance/);
  assert.match(stochasticSource, /const microVisibility = oneMinus\(smoothstep\(/);
  // The distance fade reaches the analytic micro field, which is the detail that
  // undersamples first; the meso atlas tap is mip-filtered and keeps full weight.
  assert.match(body(stochasticSource, 'projectedDetail'), /visibility: microVisibility/);
});

test('family detail cross-blends the top two families and stays continuous across the equal-weight boundary', () => {
  const blend = body(stochasticSource, 'secondaryBlend');
  const projection = body(stochasticSource, 'createTerrainMaterialFamilyMultiplier');

  // The old equal-weight "dominance" fade (detail collapsing to zero whenever
  // the top two families split 0.5/0.5) was replaced by a top-two family
  // cross-blend in bdbc6a6e. The dominance mechanism must not come back.
  assert.doesNotMatch(stochasticSource, /dominance/i);
  assert.doesNotMatch(projection, /primaryWeight\.sub\(secondaryWeight\)/);

  // Detail is always a mix of the two highest-weight families, never a switch.
  assert.match(projection, /const blend = secondaryBlend\(pair,families\);/);
  assert.match(projection, /const topDetail = mix\(topPrimary,topSecondary,blend\);/);
  assert.match(projection, /const sideDetail = mix\(sidePrimary,sideSecondary,blend\);/);
  // Confidence is a function of the *sum* of the top two weights (symmetric, so
  // continuous when the two families swap places) raised to the fade power.
  assert.match(
    projection,
    /const pairConfidence = clamp\(pair\.primaryWeight\.add\(pair\.secondaryWeight\),0,1\);/,
  );
  assert.match(
    projection,
    /const confidenceScale = pow\(pairConfidence,families\.dominantFadePower\);/,
  );
  assert.match(
    projection,
    /const strength = confidenceScale\.mul\(environmentScale\)\.mul\(families\.strength\);/,
  );
  assert.match(blend, /MAX_SECONDARY_BLEND/);
  assert.match(blend, /clamp\(/);

  // Behavioural sweep of the expressions pinned immediately above: sweep the
  // split of the top-two pair across the equal-weight boundary at several pair
  // totals and assert the guarantee that replaced the vanish-to-zero fade -
  // continuity, symmetry, and never-zero detail at the boundary.
  const { dominantFadePower, secondaryMinWeight, secondaryBlendStrength } = familiesConfig();
  const fadeWidth = moduleConstant(stochasticSource, 'SECONDARY_FADE_WIDTH');
  const minPairWeight = moduleConstant(stochasticSource, 'MIN_PAIR_WEIGHT');
  const maxSecondaryBlend = moduleConstant(stochasticSource, 'MAX_SECONDARY_BLEND');
  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  };
  const sampleAt = (total, primaryShare) => {
    const primary = total * Math.max(primaryShare, 1 - primaryShare);
    const secondary = total - primary;
    return {
      primary,
      secondary,
      // clamp(primaryWeight + secondaryWeight, 0, 1) ^ families.dominantFadePower
      confidence: clamp01(primary + secondary) ** dominantFadePower,
      // clamp(ratio * secondaryBlendStrength * visibility, 0, MAX_SECONDARY_BLEND)
      blend: Math.min(
        maxSecondaryBlend,
        (secondary / Math.max(primary + secondary, minPairWeight))
          * secondaryBlendStrength
          * smoothstep(secondaryMinWeight, secondaryMinWeight + fadeWidth, secondary),
      ),
    };
  };
  const shares = [];
  for (let share = 0.3; share <= 0.7000001; share += 0.005) shares.push(share);
  const discreteStep = (values) => values.slice(1).reduce(
    (worst, value, index) => Math.max(worst, Math.abs(value - values[index])),
    0,
  );

  for (const total of [0.2, 0.4, 0.6, 0.8, 1]) {
    const samples = shares.map((share) => sampleAt(total, share));
    // Both terms only ever read the pair *sum*, so crossing the equal-weight
    // boundary changes nothing: the detail multiplier cannot dip there.
    assert.ok(
      discreteStep(samples.map((sample) => sample.confidence)) < 1e-12,
      `family detail confidence must be flat across the equal-weight boundary at total ${total}`,
    );
    assert.ok(
      discreteStep(samples.map((sample) => sample.blend)) < 0.02,
      `family cross-blend must be continuous across the equal-weight boundary at total ${total}`,
    );
    // Swapping which family is primary is a no-op: the formula only reads the
    // pair sum and a symmetric split, so the two halves of the sweep mirror.
    assert.deepEqual(sampleAt(total, 0.3), sampleAt(total, 0.7));
    const atBoundary = sampleAt(total, 0.5);
    // Detail is at its maximum where the families are equally weighted - this is
    // exactly where the superseded dominance fade forced it to zero.
    assert.equal(atBoundary.confidence, clamp01(total) ** dominantFadePower);
    assert.ok(atBoundary.confidence > 0);
    assert.ok(
      atBoundary.blend > 0 && atBoundary.blend <= maxSecondaryBlend,
      'the secondary family must blend in, not replace, detail',
    );
  }
});

test('near and mid terrain consume the family atlas while far terrain remains baked color', () => {
  assert.match(bakedSource, /createTerrainMaterialFamilyMultiplier\(\{/);
  assert.match(bakedSource, /cameraDistance,/);
  // The family multiplier folds into the mid colour chain whatever else the
  // chain picks up (the genome colour multiplier came later), and however it is
  // wrapped.
  assert.match(
    bakedSource,
    /midColor = midColor\.mul\(familyMultiplier\)\.mul\(macroMultiplier\)/,
  );
  // `families` is the local alias of `materialBake.families` in this module.
  assert.match(
    bakedSource,
    /const nearFamily = mix\(vec3\(1\),familyMultiplier,(?:materialBake\.)?families\.nearStrength\);/,
  );
  assert.match(bakedSource, /samples\.farColor\.rgb/);
  assert.match(bakedSource, /cameraDistance\.lessThan\(farBlendEnd\)/);
});

test('terrain material owns both bake textures and the shared atlas before node assembly', () => {
  const atlasIndex = terrainSource.indexOf(
    'acquireTerrainMaterialFamilyAtlas(stylizedConfig.materialBake)',
  );
  const attachIndex = terrainSource.indexOf(
    'attachTerrainMaterialFamilyAtlas(material,familyAtlas)',
  );
  const assemblyIndex = terrainSource.indexOf('createTerrainMaterialBakedSurface({');
  assert.ok(atlasIndex >= 0, 'the material must acquire the shared family atlas');
  assert.ok(
    attachIndex > atlasIndex && assemblyIndex > attachIndex,
    'bake textures and the family atlas must be owned and attached before node assembly',
  );

  assert.match(terrainSource, /const material = new THREE\.MeshStandardNodeMaterial\(\{/);
  assert.match(terrainSource, /metalness: 0,/);
  assert.match(
    terrainSource,
    /roughness: stylizedConfig\.materialBake\.render\.fallbackRoughness,/,
  );
  // A material that owns its own bake state attaches it; a shared per-slot state
  // is supplied through TerrainSlotBindings instead.
  assert.match(terrainSource, /if\(ownBakeGpu\)attachTerrainMaterialBakeGpuState\(material,ownBakeGpu\);/);
  assert.match(terrainSource, /catch\(error\)\{[\s\S]*?material\.dispose\(\);[\s\S]*?throw error;/);
});

test('terrain stochastic coordinates stay canonical across floating-origin rebases', () => {
  assert.match(
    terrainViewSource,
    /const render = this\.floatingOrigin\.toRender\([\s\S]*?slot\.descriptor\.centerWorldX,[\s\S]*?slot\.descriptor\.centerWorldZ,/,
  );
  assert.match(
    terrainViewSource,
    /slot\.chunkCenter\.value\.set\(slot\.descriptor\.centerWorldX,slot\.descriptor\.centerWorldZ\);/,
  );
});
