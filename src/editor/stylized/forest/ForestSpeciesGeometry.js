import * as THREE from 'three';
import {
  finalizeGeometry,
  mergeParts,
  spherifyNormals,
  unitRandom,
} from './proceduralGeometry.js';

/**
 * Procedural tree prototypes for the species the source GLB does not cover.
 *
 * `grass-scene.glb` supplies only dark conifers, so `conifer_narrow` and
 * `conifer_wide` keep using those baked prototypes. The broadleaf archetypes —
 * round crowns, white-barked birch, flat tropical crowns and sparse wetland
 * stands — are built here.
 *
 * Built once at startup and cached, never during a chunk build. Age variation is
 * applied per instance by `ForestSpeciesRegistry` (`heightScale`, `trunkScale`,
 * `crownScale`), so geometry is generated per species, not per age — otherwise
 * every extra prototype would cost another pair of full-capacity InstancedMeshes.
 *
 * Output matches the `extractPrototypeParts` contract: parts tagged 'trunk' or
 * 'leaf', pivoted on the trunk base at y=0 and centred on XZ. Geometry is
 * de-indexed so merges succeed across primitive types and so crowns read as
 * hard-edged facets rather than smooth blobs.
 */

const CROWN_SEGMENTS = 0;
const TRUNK_RADIAL_SEGMENTS = 6;
// Short of 1 on purpose: fully spherical normals lose the faceting that keeps
// these crowns from looking like smooth balloons, so a little face normal stays.
const CROWN_NORMAL_SPHERIFY = 0.85;

function trunk({ height, baseRadius, topRadius, lean = 0 }) {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    baseRadius,
    height,
    TRUNK_RADIAL_SEGMENTS,
    1,
  );
  geometry.translate(0, height * 0.5, 0);
  if (lean !== 0) {
    geometry.rotateZ(lean);
  }
  return geometry;
}

/**
 * Root flare at the trunk base. `attachRootCollar` cannot be reused here: it
 * merges an indexed cylinder, and these prototypes are de-indexed for faceting,
 * so the merge would fail and the flare would be dropped.
 */
function rootFlare({ baseRadius }) {
  const radius = Math.max(0.16, baseRadius * 1.5);
  const height = Math.max(0.18, radius * 0.7);
  const geometry = new THREE.CylinderGeometry(
    baseRadius,
    radius,
    height,
    TRUNK_RADIAL_SEGMENTS + 1,
    1,
  );
  geometry.translate(0, height * 0.42, 0);
  return geometry;
}

/**
 * Angled limb from the trunk toward a crown lobe, so crowns are not floating.
 * Open-ended: both caps sit buried inside the trunk or the lobe it feeds, and at
 * one limb per lobe the tiered crowns need the triangles elsewhere.
 */
function limb({ fromY, toX, toY, toZ, radius }) {
  const length = Math.hypot(toX, toY - fromY, toZ);
  const geometry = new THREE.CylinderGeometry(radius * 0.7, radius, length, 4, 1, true);
  geometry.translate(0, length * 0.5, 0);
  const direction = new THREE.Vector3(toX, toY - fromY, toZ).normalize();
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
  );
  geometry.translate(0, fromY, 0);
  return geometry;
}

/**
 * A crown lobe, returned with the ellipsoid that produced it. The leaf cards need
 * that ellipsoid to sit on the lobe's surface, and recovering it from a merged
 * bounding box afterwards would only give the union of every lobe.
 */
function crownLobe({ x, y, z, radiusX, radiusY, radiusZ }) {
  const geometry = new THREE.DodecahedronGeometry(0.5, CROWN_SEGMENTS);
  geometry.scale(radiusX * 2, radiusY * 2, radiusZ * 2);
  geometry.translate(x, y, z);
  return {
    geometry, x, y, z, radiusX, radiusY, radiusZ,
  };
}

/**
 * A quad on a lobe's surface, facing outward, UV-mapped to the whole foliage card.
 *
 * These carry the silhouette: the alpha cut gives the ragged leafy edge that solid
 * lobes cannot, while the lobes behind them stop the canopy reading as see-through
 * — which is what would happen if the cut were applied to the lobes themselves,
 * since the card is only about a fifth opaque.
 */
function leafCard({ lobe, speciesId, channel, scale }) {
  const azimuth = unitRandom(speciesId, channel) * Math.PI * 2;
  // Uniform over the sphere rather than over latitude, so cards do not bunch at the poles.
  const cosPolar = unitRandom(speciesId, channel + 1) * 2 - 1;
  const sinPolar = Math.sqrt(Math.max(0, 1 - cosPolar * cosPolar));
  const unitX = sinPolar * Math.cos(azimuth);
  const unitY = cosPolar;
  const unitZ = sinPolar * Math.sin(azimuth);

  // `scale` is the card's half-extent as a fraction of the lobe radius. It has to
  // stay well under 1: the card is centred on the surface, so a half-extent near
  // the lobe radius doubles the crown's bounding box, and those bounds drive the
  // LOD pixel sizes and impostor radii.
  const size = Math.max(lobe.radiusX, lobe.radiusZ) * scale
    * (0.78 + unitRandom(speciesId, channel + 2) * 0.44);
  const geometry = new THREE.PlaneGeometry(size * 2, size * 2);
  geometry.rotateZ(unitRandom(speciesId, channel + 3) * Math.PI * 2);

  // Face the quad along the outward direction, then push it just past the surface
  // so it breaks the lobe's silhouette instead of z-fighting inside it.
  const normal = new THREE.Vector3(unitX, unitY, unitZ).normalize();
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
  );
  geometry.translate(
    lobe.x + unitX * lobe.radiusX * 0.82,
    lobe.y + unitY * lobe.radiusY * 0.82,
    lobe.z + unitZ * lobe.radiusZ * 0.82,
  );
  return geometry;
}

// Rotates each tier off its neighbour so the rings do not stack into a column.
const TIER_PHASE = Math.PI * 0.618;

/**
 * Crown as separated horizontal tiers rather than one ring of lobes. A single
 * ring reads as a shrub on a stick from player height; the reference art gets its
 * silhouette from two or three distinct mass layers with sky between them, which
 * is also what lets the bole stay visible through the canopy.
 *
 * `tierRise` is measured in crown radii, so a tier's gap scales with its lobes.
 * `tierGrowth` above 1 broadens upward — a beech or birch carries its widest mass
 * at the top; below 1 tapers to a spire.
 */
function tieredCrown({
  speciesId,
  tiers,
  lobesPerTier,
  spread,
  baseY,
  tierRise,
  tierGrowth,
  radius,
  flatten,
  jitter,
}) {
  const lobes = [];
  let channel = 11;
  let tierY = baseY;
  let tierRadius = radius;
  for (let tier = 0; tier < tiers; tier += 1) {
    for (let index = 0; index < lobesPerTier; index += 1) {
      const angle = (index / lobesPerTier) * Math.PI * 2
        + tier * TIER_PHASE
        + unitRandom(speciesId, channel) * jitter;
      const ringRadius = spread
        * (tierRadius / radius)
        * (0.68 + unitRandom(speciesId, channel + 1) * 0.42);
      const lobeRadius = tierRadius * (0.78 + unitRandom(speciesId, channel + 2) * 0.36);
      lobes.push(crownLobe({
        x: Math.cos(angle) * ringRadius,
        // Kept small deliberately: the old ±0.45r wander blurred tiers together.
        y: tierY + (unitRandom(speciesId, channel + 3) - 0.5) * tierRadius * 0.28,
        z: Math.sin(angle) * ringRadius,
        radiusX: lobeRadius,
        radiusY: lobeRadius * flatten,
        radiusZ: lobeRadius * (0.86 + unitRandom(speciesId, channel + 4) * 0.28),
      }));
      channel += 5;
    }
    tierY += tierRise * tierRadius;
    tierRadius *= tierGrowth;
  }
  // Caps the topmost tier, which `tierY` has already stepped past.
  const capRadius = (tierRadius / tierGrowth) * 0.9;
  lobes.push(crownLobe({
    x: 0,
    y: tierY - tierRise * (tierRadius / tierGrowth) + capRadius * flatten * 0.75,
    z: 0,
    radiusX: capRadius,
    radiusY: capRadius * flatten,
    radiusZ: capRadius,
  }));
  return lobes;
}

/**
 * `trunkHeight` runs past `crownBase` on purpose for the tiered species: the bole
 * has to be visible between the mass layers, which is most of what makes a birch
 * stand read as birch.
 */
const ARCHETYPES = Object.freeze({
  // Beech: broad, top-heavy crown over a short bole.
  broadleaf_round: Object.freeze({
    trunkHeight: 7.2,
    trunkBase: 0.34,
    trunkTop: 0.19,
    crownBase: 4.3,
    crownRadius: 1.55,
    crownSpread: 1.5,
    tiers: 2,
    lobesPerTier: 4,
    tierRise: 2.8,
    tierGrowth: 1.2,
    flatten: 0.8,
    jitter: 0.5,
    limbRadius: 0.12,
  }),
  // Birch: slender white bole rising through two separated crowns.
  broadleaf_tall: Object.freeze({
    trunkHeight: 9.6,
    trunkBase: 0.24,
    trunkTop: 0.1,
    crownBase: 5.7,
    crownRadius: 1.45,
    crownSpread: 0.95,
    tiers: 2,
    lobesPerTier: 3,
    tierRise: 2.8,
    tierGrowth: 1.36,
    flatten: 0.84,
    jitter: 0.5,
    limbRadius: 0.075,
  }),
  // Emergent tropical: bare to the canopy, then wide flat plates.
  tropical_tall: Object.freeze({
    trunkHeight: 9.4,
    trunkBase: 0.3,
    trunkTop: 0.18,
    crownBase: 8.0,
    crownRadius: 1.5,
    crownSpread: 2.2,
    tiers: 2,
    lobesPerTier: 4,
    tierRise: 2.2,
    tierGrowth: 1.2,
    flatten: 0.58,
    jitter: 0.6,
    limbRadius: 0.1,
  }),
  // Willow/alder: low, open, one broad layer with a light crest.
  wetland_sparse: Object.freeze({
    trunkHeight: 3.4,
    trunkBase: 0.4,
    trunkTop: 0.22,
    crownBase: 3.5,
    crownRadius: 1.85,
    crownSpread: 1.9,
    tiers: 1,
    lobesPerTier: 4,
    tierRise: 1.9,
    tierGrowth: 1,
    flatten: 0.74,
    jitter: 0.85,
    limbRadius: 0.13,
  }),
});

/** Species that reuse the baked GLB conifer prototypes instead of generated geometry. */
export const FOREST_GLB_CONIFER_SPECIES = Object.freeze([
  'conifer_narrow',
  'conifer_wide',
]);

export const FOREST_GENERATED_SPECIES = Object.freeze(Object.keys(ARCHETYPES));

export function createSpeciesPrototypeGeometry(speciesId, { cardsPerLobe = 0, cardScale = 0.42 } = {}) {
  const archetype = ARCHETYPES[speciesId];
  if (!archetype) {
    throw new Error(`No procedural archetype is defined for species "${speciesId}".`);
  }
  const lean = (unitRandom(speciesId, 3) - 0.5) * 0.08;
  const trunkParts = [
    trunk({
      height: archetype.trunkHeight,
      baseRadius: archetype.trunkBase,
      topRadius: archetype.trunkTop,
      lean,
    }),
    rootFlare({ baseRadius: archetype.trunkBase }),
  ];
  const lobes = tieredCrown({
    speciesId,
    tiers: archetype.tiers,
    lobesPerTier: archetype.lobesPerTier,
    spread: archetype.crownSpread,
    baseY: archetype.crownBase,
    tierRise: archetype.tierRise,
    tierGrowth: archetype.tierGrowth,
    radius: archetype.crownRadius,
    flatten: archetype.flatten,
    jitter: archetype.jitter,
  });
  // Every tier lobe gets its own limb, springing from the bole just below the
  // tier it feeds — a single shared fork would leave the upper tiers floating.
  const tierLobeCount = archetype.tiers * archetype.lobesPerTier;
  for (let index = 0; index < tierLobeCount; index += 1) {
    const lobe = lobes[index];
    trunkParts.push(limb({
      fromY: Math.min(archetype.trunkHeight * 0.94, Math.max(0, lobe.y - archetype.crownRadius)),
      toX: lobe.x,
      toY: lobe.y,
      toZ: lobe.z,
      radius: archetype.limbRadius,
    }));
  }

  const trunkGeometry = finalizeGeometry(mergeParts(trunkParts));
  // Spherified after the merge, not per lobe: the whole crown has to share one
  // gradient, or each tier lights as its own separate ball.
  const leafGeometry = spherifyNormals(
    finalizeGeometry(mergeParts(lobes.map((lobe) => lobe.geometry))),
    { strength: CROWN_NORMAL_SPHERIFY },
  );
  const cards = [];
  for (let index = 0; index < lobes.length; index += 1) {
    for (let card = 0; card < cardsPerLobe; card += 1) {
      cards.push(leafCard({
        lobe: lobes[index],
        speciesId,
        channel: 900 + index * 17 + card * 4,
        scale: cardScale,
      }));
    }
  }
  // Cards get the crown's spherified normals too, so a card and the lobe behind it
  // shade alike instead of the card reading as a flat sticker.
  const cardGeometry = cards.length > 0
    ? spherifyNormals(
      finalizeGeometry(mergeParts(cards)),
      { strength: CROWN_NORMAL_SPHERIFY, center: leafGeometry.boundingBox.getCenter(new THREE.Vector3()) },
    )
    : null;
  const bounds = trunkGeometry.boundingBox.clone().union(leafGeometry.boundingBox);
  if (cardGeometry) bounds.union(cardGeometry.boundingBox);
  return {
    speciesId,
    height: bounds.max.y - bounds.min.y,
    width: Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z),
    parts: [
      { geometry: trunkGeometry, kind: 'trunk' },
      { geometry: leafGeometry, kind: 'leaf' },
      // Its own part because it needs an alpha cut the solid lobes must not get.
      // `kind: 'leaf'` so it inherits the grove tint and the no-shadow rule.
      ...(cardGeometry ? [{ geometry: cardGeometry, kind: 'leaf', card: true }] : []),
    ],
  };
}

export function createForestSpeciesPrototypeGeometry(
  speciesIds = FOREST_GENERATED_SPECIES,
  options = {},
) {
  return speciesIds.map((speciesId) => createSpeciesPrototypeGeometry(speciesId, options));
}

/**
 * Palette overrides so each species reads distinctly through the shared leaf and
 * trunk materials. `broadleaf_tall` is the reference image's white-trunked birch.
 */
export const FOREST_SPECIES_PALETTES = Object.freeze({
  broadleaf_round: Object.freeze({
    leafBottom: '#3f7a2c',
    leafTop: '#8fc63f',
    variationColor: '#2f6a34',
    barkTint: '#7a6244',
    barkTintStrength: 0.55,
    barkBrightness: 1.2,
  }),
  broadleaf_tall: Object.freeze({
    leafBottom: '#4c8a33',
    leafTop: '#a8d152',
    variationColor: '#3b7440',
    barkTint: '#e8e6dd',
    barkTintStrength: 0.88,
    barkBrightness: 1.45,
  }),
  tropical_tall: Object.freeze({
    leafBottom: '#256b2c',
    leafTop: '#63b23a',
    variationColor: '#1f5c33',
    barkTint: '#6f5c42',
    barkTintStrength: 0.5,
    barkBrightness: 1.15,
  }),
  wetland_sparse: Object.freeze({
    leafBottom: '#42632c',
    leafTop: '#87a24a',
    variationColor: '#3a5c3a',
    barkTint: '#5d5541',
    barkTintStrength: 0.6,
    barkBrightness: 1.05,
  }),
});

/**
 * Species this file can generate geometry for, given the authored coverage a
 * scene actually loaded. Generated archetypes are a fallback, not pool members:
 * a lobe-and-cylinder tree standing beside an authored GLB reads as the cheap
 * one, and pooling them meant roughly one broadleaf in three was a blob. Build
 * them only where nothing authored claims the species.
 */
export function uncoveredGeneratedSpecies(coveredSpeciesIds) {
  const covered = coveredSpeciesIds instanceof Set
    ? coveredSpeciesIds
    : new Set(coveredSpeciesIds ?? []);
  return FOREST_GENERATED_SPECIES.filter((speciesId) => !covered.has(speciesId));
}

/**
 * Maps every species onto the prototype indices that can render it. Conifers use
 * the baked GLB range plus any authored conifer; authored broadleaf variants
 * claim their species outright. Generated archetypes only ever appear for a
 * species no variant covers, and species with no prototype at all fall back to
 * the whole GLB range so a misconfigured palette still renders something.
 *
 * `generatedFirstIndex` is where the generated prototypes begin. They are
 * appended after the authored variants — the loader cannot know which species
 * need generating until every variant has declared itself — so this is no longer
 * `glbPrototypeCount`.
 */
export function createSpeciesPrototypeIndex({
  glbPrototypeCount,
  generatedSpeciesIds,
  generatedFirstIndex = glbPrototypeCount,
  additionalPrototypeIndicesBySpecies = null,
}) {
  const glbRange = Array.from({ length: glbPrototypeCount }, (_, index) => index);
  const map = new Map();
  for (const speciesId of FOREST_GLB_CONIFER_SPECIES) {
    map.set(speciesId, glbRange);
  }
  for (const [speciesId, indices] of additionalPrototypeIndicesBySpecies ?? []) {
    const existing = map.get(speciesId) ?? [];
    map.set(speciesId, [...existing, ...indices]);
  }
  generatedSpeciesIds.forEach((speciesId, offset) => {
    if (map.has(speciesId)) {
      throw new Error(
        `Generated archetype for "${speciesId}" was built even though an authored `
        + 'variant covers it.',
      );
    }
    map.set(speciesId, [generatedFirstIndex + offset]);
  });
  return { map, fallback: glbRange };
}
