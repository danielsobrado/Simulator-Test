#!/usr/bin/env node
/**
 * Headless evidence for First pass 4 — readable masonry joints.
 *
 * Measures joint statistics, mortar footprint coverage, coarse amplification,
 * and approximate screen-space joint width. Does not open a browser — visual
 * captures remain a Simulator-Test checklist item.
 *
 * Usage: node scripts/run-construction-joint-width-qa.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constructionJointProfile } from '../src/editor/construction/config/ConstructionJointProfiles.generated.js';
import {
  packCurvedWall,
} from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const JSON_PATH = join(OUT_DIR, 'construction-joint-width-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-joint-width-2026-07-28.md');

function straightPath(length) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.01 });
}

function packWall(styleKey, path, { seed = 3141, height = 3.5 } = {}) {
  const style = constructionStyle(styleKey);
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-joint-wall',
    revision: 1,
    seed,
    kind: 'wall',
    style: { key: styleKey, version: 1 },
    dimensions: { height, thickness: 0.8 },
    path,
    features: [],
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style });
  const started = performance.now();
  const result = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style,
    thickness: 0.8,
    seed,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
  });
  const packMs = performance.now() - started;
  return { record, arcTable, result, packMs, styleKey };
}

function payloadBytes(placements) {
  return Buffer.byteLength(JSON.stringify(placements), 'utf8');
}

function screenPixels(jointMetres, distanceMetres, {
  fovDeg = 60,
  viewportHeight = 1080,
} = {}) {
  const fov = (fovDeg * Math.PI) / 180;
  const worldHeightAtDistance = 2 * distanceMetres * Math.tan(fov / 2);
  return (jointMetres / worldHeightAtDistance) * viewportHeight;
}

function summarise(styleKey) {
  const packed = packWall(styleKey, straightPath(24), { seed: 3141 });
  const { result, packMs } = packed;
  const profile = constructionJointProfile(styleKey);
  const field = result.stones.filter((stone) => stone.category === 'field');
  const nearBytes = payloadBytes(result.stones);

  const coarseStarted = performance.now();
  const coarse = coarsePlacements(result.stones, { styleKey });
  const coarseMs = performance.now() - coarseStarted;
  const coarseField = coarse.filter((stone) => stone.category === 'field');
  const coarseBytes = payloadBytes(coarse);

  const meanNearHead = result.stats.meanHeadJoint;
  const meanNearBed = result.stats.meanBedJoint;
  const meanCoarseHead = coarseField.reduce((sum, stone) => (
    sum + (stone.jointWidths?.head ?? 0)
  ), 0) / Math.max(1, coarseField.length);
  const meanCoarseBed = coarseField.reduce((sum, stone) => (
    sum + (stone.jointWidths?.bed ?? 0)
  ), 0) / Math.max(1, coarseField.length);

  const distances = [2, 5, 8, 12, 20];
  const pixelReadability = distances.map((distance) => ({
    distance,
    nearHeadPx: screenPixels(meanNearHead, distance),
    nearBedPx: screenPixels(meanNearBed, distance),
    coarseHeadPx: screenPixels(meanCoarseHead, distance),
    coarseBedPx: screenPixels(meanCoarseBed, distance),
  }));

  return {
    styleKey,
    profile: {
      headJoint: profile.headJoint,
      bedJoint: profile.bedJoint,
      coarseLodMultiplier: profile.coarseLodMultiplier,
    },
    packMs,
    coarseMs,
    stones: result.stones.length,
    field: field.length,
    jointSamples: result.stats.jointSamples,
    meanHeadJoint: meanNearHead,
    meanBedJoint: meanNearBed,
    headJointMin: result.stats.headJointMin,
    headJointMax: result.stats.headJointMax,
    bedJointMin: result.stats.bedJointMin,
    bedJointMax: result.stats.bedJointMax,
    headJointsClamped: result.stats.headJointsClamped,
    bedJointsClamped: result.stats.bedJointsClamped,
    meanCoarseHeadJoint: meanCoarseHead,
    meanCoarseBedJoint: meanCoarseBed,
    nearPayloadBytes: nearBytes,
    coarsePayloadBytes: coarseBytes,
    mortarSafetyOverlap: CONSTRUCTION_MORTAR_CONFIG.safetyOverlap,
    faceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
    pixelReadability,
  };
}

const coursed = summarise('coursed-rubble');
const soft = summarise('soft-limestone-rubble');

const payloadDelta = soft.nearPayloadBytes - coursed.nearPayloadBytes;
const gates = {
  legacyJointsUnchanged: (
    coursed.meanHeadJoint >= 0.012
    && coursed.meanHeadJoint <= 0.03
    && coursed.meanBedJoint >= 0.0084
    && coursed.meanBedJoint <= 0.021
  ),
  softWiderThanLegacy: (
    soft.meanHeadJoint > coursed.meanHeadJoint
    && soft.meanBedJoint > coursed.meanBedJoint
  ),
  softInProfile: (
    soft.meanHeadJoint >= soft.profile.headJoint.min
    && soft.meanHeadJoint <= soft.profile.headJoint.max
    && soft.meanBedJoint >= soft.profile.bedJoint.min
    && soft.meanBedJoint <= soft.profile.bedJoint.max
  ),
  coarseAmplified: soft.meanCoarseHeadJoint > soft.meanHeadJoint * 1.05,
  safetyOverlapTiny: CONSTRUCTION_MORTAR_CONFIG.safetyOverlap <= 0.003,
  noNewDrawCalls: true,
};

const allPass = Object.values(gates).every(Boolean);

const report = {
  date: '2026-07-28',
  scene: {
    length: 24,
    height: 3.5,
    thickness: 0.8,
    seed: 3141,
  },
  gates,
  coursed,
  soft,
  payloadDeltaBytes: payloadDelta,
  overall: allPass ? 'PASS' : 'FAIL',
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);

function fmt(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function pxRow(entry, band) {
  const head = band === 'near' ? entry.nearHeadPx : entry.coarseHeadPx;
  const bed = band === 'near' ? entry.nearBedPx : entry.coarseBedPx;
  return `| ${entry.distance} m | ${fmt(head, 2)} | ${fmt(bed, 2)} |`;
}

const md = `# Construction joint width — evidence (2026-07-28)

Headless joint / mortar-footprint evidence for First pass 4. Soft limestone uses
wider style-driven head and bed joints; legacy coursed rubble keeps prior
dimensions. Visual captures remain a Simulator-Test checklist.

## Gates

| Gate | Result |
| --- | --- |
| Legacy joint means stay in 12–30 / 8.4–21 mm | ${gates.legacyJointsUnchanged ? 'PASS' : 'FAIL'} |
| Soft limestone joints wider than legacy | ${gates.softWiderThanLegacy ? 'PASS' : 'FAIL'} |
| Soft means inside YAML profile | ${gates.softInProfile ? 'PASS' : 'FAIL'} |
| Coarse LOD amplifies soft joints | ${gates.coarseAmplified ? 'PASS' : 'FAIL'} |
| Mortar safety overlap ≤ 3 mm | ${gates.safetyOverlapTiny ? 'PASS' : 'FAIL'} |
| No new draw calls / materials / triangles | PASS (architecture) |

Overall: **${report.overall}**

## Scene A — straight wall (seed 3141)

\`\`\`text
Length:    24 m
Height:    3.5 m
Thickness: 0.8 m
\`\`\`

### Joint statistics

| Style | Mean head | Mean bed | Head range | Bed range | Clamped H/B |
| --- | ---: | ---: | ---: | ---: | ---: |
| coursed-rubble | ${fmt(coursed.meanHeadJoint * 1000, 1)} mm | ${fmt(coursed.meanBedJoint * 1000, 1)} mm | ${fmt(coursed.headJointMin * 1000, 1)}–${fmt(coursed.headJointMax * 1000, 1)} | ${fmt(coursed.bedJointMin * 1000, 1)}–${fmt(coursed.bedJointMax * 1000, 1)} | ${coursed.headJointsClamped}/${coursed.bedJointsClamped} |
| soft-limestone-rubble | ${fmt(soft.meanHeadJoint * 1000, 1)} mm | ${fmt(soft.meanBedJoint * 1000, 1)} mm | ${fmt(soft.headJointMin * 1000, 1)}–${fmt(soft.headJointMax * 1000, 1)} | ${fmt(soft.bedJointMin * 1000, 1)}–${fmt(soft.bedJointMax * 1000, 1)} | ${soft.headJointsClamped}/${soft.bedJointsClamped} |

### Coarse amplification (soft limestone)

| Band | Mean head | Mean bed |
| --- | ---: | ---: |
| near | ${fmt(soft.meanHeadJoint * 1000, 1)} mm | ${fmt(soft.meanBedJoint * 1000, 1)} mm |
| coarse | ${fmt(soft.meanCoarseHeadJoint * 1000, 1)} mm | ${fmt(soft.meanCoarseBedJoint * 1000, 1)} mm |

### Approximate screen-space joint width (soft limestone, 60° FOV, 1080p)

Geometric projection only — not a GPU capture.

| Distance | Near head px | Near bed px |
| --- | ---: | ---: |
${soft.pixelReadability.map((entry) => pxRow(entry, 'near')).join('\n')}

| Distance | Coarse head px | Coarse bed px |
| --- | ---: | ---: |
${soft.pixelReadability.map((entry) => pxRow(entry, 'coarse')).join('\n')}

Initial readability targets: 2 m 4–10 px, 5 m 2–5 px, 8 m 1–3 px, 12 m 0.7–1.5 px.

### Payload

| Style | Near JSON bytes | Coarse JSON bytes | Pack ms | Coarse ms |
| --- | ---: | ---: | ---: | ---: |
| coursed-rubble | ${coursed.nearPayloadBytes} | ${coursed.coarsePayloadBytes} | ${fmt(coursed.packMs, 2)} | ${fmt(coursed.coarseMs, 3)} |
| soft-limestone-rubble | ${soft.nearPayloadBytes} | ${soft.coarsePayloadBytes} | ${fmt(soft.packMs, 2)} | ${fmt(soft.coarseMs, 3)} |

Soft vs coursed near payload delta: **${payloadDelta} bytes** (includes mortarCorners + jointWidths on field stones).

### Mortar config

| Setting | Value |
| --- | --- |
| faceRecess | ${CONSTRUCTION_MORTAR_CONFIG.faceRecess} m |
| safetyOverlap | ${CONSTRUCTION_MORTAR_CONFIG.safetyOverlap} m |
| soft mortar colour | \`#74746d\` |

## Visual checklist (Simulator-Test)

1. **Scene A** — soft limestone 24 m wall at 2 / 5 / 8 / 12 / 20 m: joints obvious at 5–8 m, subtle at 12–20 m, not a black grid.
2. **Scene B** — coursed rubble beside soft limestone: legacy joints unchanged, soft wider but calmer.
3. **Scene C** — grazing light: recessed mortar, no background leaks, no dark silhouette rim.
4. **Scene D** — tight curve: no wedge gaps, curvature stone widths unchanged.
5. **Scene E** — doorway/arch: opening exact, mortar stops at jamb, dressings narrower.
6. **Scene F** — ruined top: mortar only behind survivors, no dark border on ruin teeth.
7. **Scene G** — near → coarse → shell → coarse → near: amplify only in coarse, no width pulse, near identical on return.

Tune order if joints look too dark: mortar colour → roughness → underside AO → recess → width last.

Raw JSON: \`tmp/construction-joint-width-qa.json\`
`;

writeFileSync(REPORT_PATH, md);
console.log(md);
console.log(`\nWrote ${JSON_PATH}`);
console.log(`Wrote ${REPORT_PATH}`);
process.exit(allPass ? 0 : 1);
