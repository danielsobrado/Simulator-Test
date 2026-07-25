import * as THREE from 'three/webgpu';
import { createRandom, mixSeed } from './ProceduralRandom.js';
import {
  beveledBox,
  cylinder,
  leaf,
  normalizeGeometry,
  transformGeometry,
} from './ProceduralWorkshopGeometry.js';

const TAU = Math.PI * 2;

// Seed channels keep each cluster independent, so editing the bush count never
// reshuffles the rocks.
const CHANNEL = Object.freeze({
  mound: 4101,
  path: 4211,
  steps: 4327,
  rocks: 4441,
  bushes: 4567,
  flowers: 4691,
});

const SOIL = Object.freeze([0.35, 0.28, 0.19]);
const SOIL_DRY = Object.freeze([0.46, 0.39, 0.26]);
const GRASS = Object.freeze([0.29, 0.45, 0.19]);
const PATH_DIRT = Object.freeze([0.55, 0.47, 0.34]);
const ROCK = Object.freeze([0.47, 0.47, 0.44]);
const FOLIAGE = Object.freeze([0.24, 0.45, 0.18]);
const PETAL = Object.freeze([0.45, 0.33, 0.66]);
const PETAL_TIP = Object.freeze([0.86, 0.84, 0.92]);

function lerp3(from, to, amount) {
  const ratio = Math.min(1, Math.max(0, amount));
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ];
}

function shade(base, amount) {
  const factor = 1 - Math.min(0.7, Math.max(0, amount));
  return [base[0] * factor, base[1] * factor, base[2] * factor];
}

function paint(geometry, colorAt) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const color = colorAt(
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    );
    colors[index * 3] = THREE.MathUtils.clamp(color[0], 0, 1);
    colors[index * 3 + 1] = THREE.MathUtils.clamp(color[1], 0, 1);
    colors[index * 3 + 2] = THREE.MathUtils.clamp(color[2], 0, 1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function gardenMaterial(slot) {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  });
  material.userData.workshopSlot = slot;
  return material;
}

function pushTriangle(target, a, b, c) {
  target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function surfaceGeometry(positions, uvScale) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  const vertexCount = positions.length / 3;
  const uv = new Float32Array(vertexCount * 2);
  for (let index = 0; index < vertexCount; index += 1) {
    uv[index * 2] = positions[index * 3] * uvScale;
    uv[index * 2 + 1] = positions[index * 3 + 2] * uvScale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The mound is a dish rather than a hill: the pad under the building stays at
 * y = 0 so the generated walls are never buried, and the ground falls away
 * toward the rim. That reads as a raised pedestal without touching terrain.
 */
export function createMoundSurface(recipe, footprint) {
  const { mound } = recipe.environment;
  const radiusX = Math.max(
    footprint.halfWidth + 0.9,
    footprint.halfWidth * mound.radius + 0.6,
  );
  const radiusZ = Math.max(
    footprint.halfDepth + 0.9,
    footprint.halfDepth * mound.radius + 0.6,
  );
  const random = createRandom(mixSeed(recipe.seed, CHANNEL.mound));
  const wobblePhaseA = random() * TAU;
  const wobblePhaseB = random() * TAU;
  const bumpPhaseA = random() * TAU;
  const bumpPhaseB = random() * TAU;
  const exponent = 0.55 + mound.slope * 1.1;
  const skirt = 0.6 + mound.height * 0.5;

  function wobble(theta) {
    return 1
      + Math.sin(theta * 3 + wobblePhaseA) * 0.13
      + Math.sin(theta * 5 + wobblePhaseB) * 0.07;
  }

  function normalizedRadius(x, z) {
    if (x === 0 && z === 0) return 0;
    const spread = wobble(Math.atan2(z, x));
    return Math.hypot(x / (radiusX * spread), z / (radiusZ * spread));
  }

  function heightForRadius(t, x, z) {
    const clamped = Math.min(1, Math.max(0, t));
    const fall = -mound.height * (1 - (1 - clamped * clamped) ** exponent);
    const bump = Math.sin(x * 0.85 + bumpPhaseA)
      * Math.cos(z * 1.05 + bumpPhaseB)
      * mound.height
      * 0.36
      * clamped
      * (1 - clamped);
    return fall + bump;
  }

  return {
    radiusX,
    radiusZ,
    skirt,
    height: mound.height,
    wobble,
    normalizedRadius,
    heightAt(x, z) {
      return heightForRadius(normalizedRadius(x, z), x, z);
    },
    pointAt(theta, t) {
      const spread = wobble(theta);
      const x = Math.cos(theta) * radiusX * spread * t;
      const z = Math.sin(theta) * radiusZ * spread * t;
      return { x, y: heightForRadius(t, x, z), z };
    },
  };
}

function createMoundGeometry(recipe, surface) {
  const rings = recipe.detail === 3 ? 15 : recipe.detail === 2 ? 11 : 8;
  const sectors = recipe.detail === 3 ? 48 : recipe.detail === 2 ? 34 : 22;
  const positions = [];
  const ringAt = (ringIndex) => Array.from({ length: sectors + 1 }, (unused, sector) => (
    surface.pointAt((sector % sectors) / sectors * TAU, ringIndex / rings)
  ));

  const centre = surface.pointAt(0, 0);
  let inner = ringAt(1);
  for (let sector = 0; sector < sectors; sector += 1) {
    pushTriangle(positions, centre, inner[sector + 1], inner[sector]);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const outer = ringAt(ring + 1);
    for (let sector = 0; sector < sectors; sector += 1) {
      pushTriangle(positions, inner[sector], inner[sector + 1], outer[sector]);
      pushTriangle(positions, inner[sector + 1], outer[sector + 1], outer[sector]);
    }
    inner = outer;
  }

  // Rim skirt: drops below the terrace plinth the placement system renders.
  for (let sector = 0; sector < sectors; sector += 1) {
    const top = inner[sector];
    const nextTop = inner[sector + 1];
    const base = { x: top.x, y: top.y - surface.skirt, z: top.z };
    const nextBase = { x: nextTop.x, y: nextTop.y - surface.skirt, z: nextTop.z };
    pushTriangle(positions, top, base, nextTop);
    pushTriangle(positions, nextTop, base, nextBase);
  }

  const rimY = -surface.height * 0.98;
  return paint(surfaceGeometry(positions, 0.18), (x, y, z) => {
    const grass = (1 - Math.min(1, surface.normalizedRadius(x, z)) * 1.25)
      * (1 - recipe.weathering * 0.35);
    const dry = (Math.sin(x * 1.7) * Math.cos(z * 1.9) + 1) * 0.5;
    return shade(
      lerp3(lerp3(SOIL, SOIL_DRY, dry * 0.6), GRASS, grass),
      y < rimY ? 0.38 : 0,
    );
  });
}

function pathCentreline(recipe, surface, footprint) {
  const random = createRandom(mixSeed(recipe.seed, CHANNEL.path));
  const sway = (random() - 0.5) * footprint.halfWidth * 0.5;
  const start = footprint.halfDepth + 0.25;
  const end = surface.radiusZ * surface.wobble(Math.PI / 2);
  const samples = recipe.detail === 1 ? 7 : 11;
  return Array.from({ length: samples }, (unused, index) => {
    const ratio = index / (samples - 1);
    const z = start + (end - start) * ratio;
    const x = sway * Math.sin(ratio * Math.PI) * 0.9;
    return { x, z, ratio, y: surface.heightAt(x, z) };
  });
}

function createPathGeometry(recipe, centreline) {
  const { path } = recipe.environment;
  const positions = [];
  const halfWidthAt = (ratio) => path.width * (0.62 + ratio * 0.55) * 0.5;
  for (let index = 0; index < centreline.length - 1; index += 1) {
    const near = centreline[index];
    const far = centreline[index + 1];
    const nearHalf = halfWidthAt(near.ratio);
    const farHalf = halfWidthAt(far.ratio);
    const a = { x: near.x - nearHalf, y: near.y + 0.03, z: near.z };
    const b = { x: near.x + nearHalf, y: near.y + 0.03, z: near.z };
    const c = { x: far.x + farHalf, y: far.y + 0.03, z: far.z };
    const d = { x: far.x - farHalf, y: far.y + 0.03, z: far.z };
    pushTriangle(positions, a, c, b);
    pushTriangle(positions, a, d, c);
  }
  return paint(surfaceGeometry(positions, 0.3), (x, unusedY, z) => lerp3(
    PATH_DIRT,
    SOIL_DRY,
    (Math.sin(x * 2.3) * Math.cos(z * 2.1) + 1) * 0.25,
  ));
}

function createStepGeometries(recipe, centreline) {
  const { steps, path } = recipe.environment;
  const first = centreline[Math.floor(centreline.length * 0.45)];
  const last = centreline[centreline.length - 1];
  const span = last.z - first.z;
  if (steps.count === 0 || span <= 0.2) return [];

  const random = createRandom(mixSeed(recipe.seed, CHANNEL.steps));
  const drop = first.y - last.y;
  const tread = span / steps.count;
  return Array.from({ length: steps.count }, (unused, index) => {
    const ratio = (index + 0.5) / steps.count;
    const riser = Math.max(0.24, Math.abs(drop) / steps.count + 0.14);
    const top = first.y + (last.y - first.y) * ((index + 1) / steps.count);
    const jitter = random();
    return paint(
      beveledBox({
        width: path.width * 1.08 * (0.94 + jitter * 0.12),
        height: riser,
        depth: tread * 1.12,
        position: [
          first.x + (last.x - first.x) * ratio + (jitter - 0.5) * 0.06,
          top - riser / 2,
          first.z + span * ratio,
        ],
        rotation: [0, (jitter - 0.5) * 0.07, 0],
        detail: recipe.detail,
        bevelRatio: 0.09,
      }),
      () => shade(ROCK, 0.05 + jitter * 0.24),
    );
  });
}

function insideBuilding(x, z, footprint, margin) {
  return Math.abs(x) < footprint.halfWidth + margin
    && Math.abs(z) < footprint.halfDepth + margin;
}

function nearPath(x, z, recipe) {
  const { path } = recipe.environment;
  return path.enabled && z > 0 && Math.abs(x) < path.width * 0.85;
}

function placeProps(count, recipe, surface, footprint, channel, {
  innerRatio,
  outerRatio,
  margin,
}) {
  const random = createRandom(mixSeed(recipe.seed, channel));
  return Array.from({ length: count }, (unused, index) => {
    let theta = ((index + 0.5) / count) * TAU + (random() - 0.5) * (TAU / count) * 0.7;
    let t = innerRatio + (outerRatio - innerRatio) * random();
    let point = surface.pointAt(theta, t);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (
        !insideBuilding(point.x, point.z, footprint, margin)
        && !nearPath(point.x, point.z, recipe)
      ) break;
      theta += 0.42;
      t = Math.min(outerRatio, t + 0.06);
      point = surface.pointAt(theta, t);
    }
    return { ...point, jitter: random(), spin: random() * TAU };
  });
}

function createRockClusters(recipe, surface, footprint) {
  const { rocks } = recipe.environment;
  const detail = recipe.detail >= 3 ? 1 : 0;
  return placeProps(rocks.count, recipe, surface, footprint, CHANNEL.rocks, {
    innerRatio: 0.5,
    outerRatio: 0.96,
    margin: 0.5,
  }).map((placement) => {
    const size = (0.36 + placement.jitter * 0.42) * rocks.scale;
    return [
      { radius: size, offset: [0, size * 0.24, 0], squash: [1.2, 0.78, 1.05] },
      {
        radius: size * 0.56,
        offset: [size * 0.72, size * 0.02, -size * 0.34],
        squash: [1, 0.82, 1.15],
      },
      {
        radius: size * 0.4,
        offset: [-size * 0.62, -size * 0.06, size * 0.46],
        squash: [1.1, 0.7, 1],
      },
    ].map((lobe, lobeIndex) => paint(
      transformGeometry(
        normalizeGeometry(new THREE.DodecahedronGeometry(lobe.radius, detail)),
        {
          position: [
            placement.x + lobe.offset[0],
            placement.y + lobe.offset[1],
            placement.z + lobe.offset[2],
          ],
          rotation: [
            placement.jitter * 0.5,
            placement.spin + lobeIndex,
            placement.jitter * 0.3,
          ],
          scale: lobe.squash,
        },
      ),
      (unusedX, y) => shade(
        ROCK,
        0.06 + lobeIndex * 0.07 + Math.max(0, placement.y - y) * 0.3,
      ),
    ));
  });
}

function createBushClusters(recipe, surface, footprint) {
  const { bushes } = recipe.environment;
  const blobCount = recipe.detail === 1 ? 3 : recipe.detail === 2 ? 4 : 5;
  return placeProps(bushes.count, recipe, surface, footprint, CHANNEL.bushes, {
    innerRatio: 0.32,
    outerRatio: 0.88,
    margin: 0.15,
  }).map((placement) => {
    const size = (0.42 + placement.jitter * 0.3) * bushes.scale;
    const group = [];
    for (let index = 0; index < blobCount; index += 1) {
      const angle = placement.spin + (index / blobCount) * TAU;
      const spread = index === 0 ? 0 : size * (0.42 + (index % 2) * 0.22);
      const radius = size * (index === 0 ? 0.92 : 0.6 + ((index * 37) % 20) / 60);
      group.push(paint(
        transformGeometry(
          normalizeGeometry(new THREE.IcosahedronGeometry(radius, 1)),
          {
            position: [
              placement.x + Math.cos(angle) * spread,
              placement.y + radius * 0.62 + (index === 0 ? 0 : size * 0.12),
              placement.z + Math.sin(angle) * spread,
            ],
            rotation: [0, angle, 0],
            scale: [1.15, 0.86, 1.15],
          },
        ),
        (unusedX, y) => shade(
          FOLIAGE,
          0.3 - Math.min(0.28, (y - placement.y) * 0.34) + (index % 3) * 0.05,
        ),
      ));
    }
    if (recipe.detail >= 2) {
      for (let index = 0; index < 4; index += 1) {
        const angle = placement.spin * 1.7 + index * 1.9;
        group.push(paint(
          leaf({
            radius: size * 0.3,
            position: [
              placement.x + Math.cos(angle) * size * 0.82,
              placement.y + size * (0.5 + (index % 2) * 0.4),
              placement.z + Math.sin(angle) * size * 0.82,
            ],
            rotation: [0.5, angle, 0.3],
          }),
          () => shade(FOLIAGE, 0.08 + (index % 2) * 0.1),
        ));
      }
    }
    return group;
  });
}

function createFlowerClusters(recipe, surface, footprint) {
  const { flowers } = recipe.environment;
  const stemCount = recipe.detail === 1 ? 4 : recipe.detail === 2 ? 6 : 8;
  return placeProps(flowers.count, recipe, surface, footprint, CHANNEL.flowers, {
    innerRatio: 0.36,
    outerRatio: 0.92,
    margin: 0.1,
  }).map((placement) => {
    const height = (0.62 + placement.jitter * 0.45) * flowers.scale;
    const group = [];
    for (let index = 0; index < stemCount; index += 1) {
      const angle = placement.spin + (index / stemCount) * TAU;
      const offset = 0.1 + ((index * 53) % 17) / 90;
      const stemHeight = height * (0.72 + ((index * 29) % 13) / 32);
      const x = placement.x + Math.cos(angle) * offset;
      const z = placement.z + Math.sin(angle) * offset;
      group.push(paint(
        cylinder({
          radius: 0.022,
          height: stemHeight,
          position: [x, placement.y + stemHeight / 2, z],
          sides: 5,
        }),
        () => shade(FOLIAGE, 0.22),
      ));
      const spikeBase = placement.y + stemHeight;
      group.push(paint(
        transformGeometry(
          normalizeGeometry(new THREE.IcosahedronGeometry(0.075 * flowers.scale, 0)),
          {
            position: [x, spikeBase + height * 0.14, z],
            rotation: [0, angle, 0],
            scale: [1, 2.6, 1],
          },
        ),
        (unusedX, y) => lerp3(PETAL, PETAL_TIP, (y - spikeBase) * 1.6),
      ));
    }
    return group;
  });
}

function tagged(geometries, material, id, label, kind) {
  const component = Object.freeze({ id, label, kind });
  return geometries.map((geometry) => ({
    geometry,
    material,
    matrix: new THREE.Matrix4(),
    environmentComponent: component,
  }));
}

/**
 * Builds the surroundings for one workshop recipe. Every returned part carries
 * an `environmentComponent` tag so the component classifier can keep it out of
 * the building's structure heuristics and the bake can keep it out of the
 * placement footprint.
 */
export function createGardenParts(recipe, footprint) {
  const surface = createMoundSurface(recipe, footprint);
  const centreline = pathCentreline(recipe, surface, footprint);
  const ground = gardenMaterial('ground');
  const stone = gardenMaterial('gardenstone');
  const plant = gardenMaterial('gardenplant');
  const parts = [];

  try {
    if (recipe.environment.mound.height > 0) {
      parts.push(...tagged(
        [createMoundGeometry(recipe, surface)],
        ground,
        'ground-mound',
        'Ground mound',
        'ground',
      ));
    }
    if (recipe.environment.path.enabled) {
      parts.push(...tagged(
        [createPathGeometry(recipe, centreline)],
        ground,
        'ground-path',
        'Path',
        'ground',
      ));
    }
    if (recipe.environment.steps.enabled) {
      const risers = createStepGeometries(recipe, centreline);
      if (risers.length > 0) {
        parts.push(...tagged(risers, stone, 'ground-steps', 'Steps', 'ground'));
      }
    }
    createRockClusters(recipe, surface, footprint).forEach((cluster, index) => {
      parts.push(...tagged(cluster, stone, `rock-${index + 1}`, `Rock ${index + 1}`, 'rock'));
    });
    createBushClusters(recipe, surface, footprint).forEach((cluster, index) => {
      parts.push(...tagged(cluster, plant, `bush-${index + 1}`, `Bush ${index + 1}`, 'plant'));
    });
    createFlowerClusters(recipe, surface, footprint).forEach((cluster, index) => {
      parts.push(...tagged(
        cluster,
        plant,
        `flowers-${index + 1}`,
        `Flower bed ${index + 1}`,
        'plant',
      ));
    });
  } catch (error) {
    parts.forEach((part) => part.geometry.dispose());
    [ground, stone, plant].forEach((material) => material.dispose());
    throw error;
  }

  for (const material of [ground, stone, plant]) {
    if (!parts.some((part) => part.material === material)) material.dispose();
  }
  return parts;
}
