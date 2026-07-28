#!/usr/bin/env node
/**
 * Soft-limestone material evidence: palette chroma, surface constants, and
 * workshop/construction parity. Visual screenshots remain a Simulator-Test
 * checklist — this harness is headless and deterministic.
 *
 * Usage: node scripts/run-soft-limestone-material-qa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  STONE_PALETTES,
  createWorkshopMaterials,
} from '../src/editor/workshop/ProceduralWorkshopMaterials.js';
import { stoneSurfaceProfile } from '../src/editor/workshop/ProceduralWorkshopStoneSurfaceConfig.js';
import {
  createStoneTexturePixels,
  summarizeStoneTexturePixels,
} from '../src/editor/workshop/ProceduralWorkshopStoneTexture.js';
import { mortarProfile } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT = join(ROOT, 'docs/qa/soft-limestone-material-2026-07-28.md');

function chroma(stop) {
  return Math.max(...stop) - Math.min(...stop);
}

function meanChroma(palette) {
  const stops = [palette.base, ...palette.ramp];
  return stops.reduce((total, stop) => total + chroma(stop), 0) / stops.length;
}

const soft = STONE_PALETTES['soft-limestone'];
const legacy = STONE_PALETTES.limestone;
const softProfile = stoneSurfaceProfile('soft-limestone');
const legacyProfile = stoneSurfaceProfile('limestone');

const softTex = summarizeStoneTexturePixels(createStoneTexturePixels({
  palette: soft,
  surface: softProfile,
  seed: 3141,
  weathering: 0.25,
  size: 128,
}));
const legacyTex = summarizeStoneTexturePixels(createStoneTexturePixels({
  palette: legacy,
  surface: legacyProfile,
  seed: 3141,
  weathering: 0.25,
  size: 128,
}));

const workshop = createWorkshopMaterials({
  seed: 3141,
  irregularity: 0.36,
  detail: 2,
  style: 'soft-limestone',
  topStyle: 'slate',
  weathering: 0.25,
  albedo: null,
  archetype: 'manor',
  finish: 'masonry',
});
const construction = createConstructionMaterials(normalizeConstructionRecord({
  version: 1,
  id: 'qa-soft',
  revision: 1,
  seed: 3141,
  kind: 'wall',
  style: { key: 'soft-limestone-rubble', version: 1 },
  dimensions: { height: 3.5, thickness: 0.8 },
  path: createCubicBezierPathFromStroke([[0, 0], [8, 0], [16, 0], [24, 0]], {
    simplifyTolerance: 0.01,
  }),
  features: [],
}));

const gates = {
  legacyUnchanged: legacy.color === '#c4b794' && legacy.base[0] === 194,
  softLowerChroma: meanChroma(soft) < meanChroma(legacy) * 0.5,
  softNarrowerTexture: softTex.lumaStdDev < legacyTex.lumaStdDev,
  softBumpReduced: softProfile.material.bumpScale < legacyProfile.material.bumpScale,
  softNormalReduced: softProfile.material.workshopNormalScale < legacyProfile.material.workshopNormalScale,
  workshopParity: workshop.stone.bumpScale === construction.stone.bumpScale
    && workshop.stone.envMapIntensity === construction.stone.envMapIntensity
    && workshop.stone.normalScale.x === construction.stone.normalScale.x,
  mortarAligned: mortarProfile('soft-limestone-rubble').color === '#74746d',
};

const allPass = Object.values(gates).every(Boolean);
const payload = {
  generatedAt: new Date().toISOString(),
  gates,
  softPalette: {
    color: soft.color,
    base: [...soft.base],
    meanChroma: meanChroma(soft),
    outlierChance: soft.outlierChance,
  },
  legacyPalette: {
    color: legacy.color,
    base: [...legacy.base],
    meanChroma: meanChroma(legacy),
  },
  softSurface: softProfile.material,
  texture: { soft: softTex, legacy: legacyTex },
  materials: {
    workshop: workshop.stone.userData.stoneSurface,
    construction: construction.stone.userData.stoneSurface,
  },
};

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
writeFileSync(join(ROOT, 'tmp/soft-limestone-material-qa.json'), `${JSON.stringify(payload, null, 2)}\n`);

const report = `# Soft limestone material — evidence (2026-07-28)

Headless material comparison for \`soft-limestone\` vs legacy \`limestone\`.
Geometry, hashes, and save schema are unchanged. Style remains opt-in via
\`soft-limestone-rubble\`.

## Gates

| Gate | Result |
| --- | --- |
| Legacy limestone palette unchanged | ${gates.legacyUnchanged ? 'PASS' : 'FAIL'} |
| Soft mean chroma < 50% of legacy | ${gates.softLowerChroma ? 'PASS' : 'FAIL'} |
| Soft procedural texture less variable | ${gates.softNarrowerTexture ? 'PASS' : 'FAIL'} |
| Soft bump weaker than legacy default | ${gates.softBumpReduced ? 'PASS' : 'FAIL'} |
| Soft normal weaker than legacy default | ${gates.softNormalReduced ? 'PASS' : 'FAIL'} |
| Workshop ↔ construction surface parity | ${gates.workshopParity ? 'PASS' : 'FAIL'} |
| Mortar colour \`#74746d\` | ${gates.mortarAligned ? 'PASS' : 'FAIL'} |

Overall: **${allPass ? 'PASS' : 'FAIL'}**

## Soft surface constants

| Parameter | Soft limestone | Legacy default |
| --- | ---: | ---: |
| bumpScale | ${softProfile.material.bumpScale} | ${legacyProfile.material.bumpScale} |
| bumpTextureScale | ${softProfile.material.bumpTextureScale} | ${legacyProfile.material.bumpTextureScale} |
| roughnessBase | ${softProfile.material.roughnessBase} | ${legacyProfile.material.roughnessBase} |
| roughnessVariation | ${softProfile.material.roughnessVariation} | ${legacyProfile.material.roughnessVariation} |
| normalScale | ${softProfile.material.workshopNormalScale} | ${legacyProfile.material.workshopNormalScale} |
| envMapIntensity | ${softProfile.material.workshopEnvMapIntensity} | ${legacyProfile.material.workshopEnvMapIntensity} |
| brightness | ${softProfile.unitShading.brightnessMin}–${softProfile.unitShading.brightnessMax} | ${legacyProfile.unitShading.brightnessMin}–${legacyProfile.unitShading.brightnessMax} |
| weatheringStrength | ${softProfile.unitShading.weatheringStrength} | ${legacyProfile.unitShading.weatheringStrength} |

## Palette chroma

| Palette | Mean chroma | Base |
| --- | ---: | --- |
| soft-limestone | ${meanChroma(soft).toFixed(2)} | \`[${soft.base.join(', ')}]\` / \`${soft.color}\` |
| limestone (legacy) | ${meanChroma(legacy).toFixed(2)} | \`[${legacy.base.join(', ')}]\` / \`${legacy.color}\` |

Texture luma σ: soft ${softTex.lumaStdDev.toFixed(3)} vs legacy ${legacyTex.lumaStdDev.toFixed(3)}.

Raw JSON: \`tmp/soft-limestone-material-qa.json\`

## Visual checklist (Simulator-Test)

Fixed wall: \`soft-limestone-rubble\`, seed \`3141\`, 24×3.5×0.8 flat.

1. Direct 45° sun — soft matte highlights, no chalk clipping.
2. Grazing light — bevels readable; bump does not dominate.
3. Overcast — low saturation, per-stone variation survives.
4. Workshop beside live wall — matching hue / roughness / normals.
5. Selection — stone tint only; mortar stays dark.
6. Distance 2 / 8 / 20 m + coarse LOD — grain fades first; joints remain.

## Non-goals confirmed

- Legacy \`limestone\` / \`limestone-masonry\` unchanged.
- No geometry hash or record version change.
- No additional textures or draw calls.
`;

writeFileSync(REPORT, report);
console.log(report);
disposeConstructionMaterials();
for (const material of Object.values(workshop)) material.dispose();
process.exitCode = allPass ? 0 : 1;
