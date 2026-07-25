import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeProceduralRecipe } from './ProceduralAssetStore.js';
import {
  archedPanel,
  beveledBox,
  coneRoof,
  cylinder,
  flagGeometry,
  gablePanel,
  leaf,
  wallRoofPlanes,
} from './ProceduralWorkshopGeometry.js';
import {
  applyStoneColor,
  createWorkshopMaterials,
} from './ProceduralWorkshopMaterials.js';
import { resolveWorkshopOpeningLayout } from './ProceduralWorkshopOpeningLayout.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';

const TAU = Math.PI * 2;

function shortAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function openingHalfWidth(opening, y) {
  const localY = y - opening.bottom;
  if (localY < 0 || localY > opening.springHeight + opening.radius) return 0;
  if (localY <= opening.springHeight) return opening.width / 2;
  const archY = localY - opening.springHeight;
  return Math.sqrt(Math.max(0, opening.radius ** 2 - archY ** 2));
}

function isInsideOpening(opening, x, y, stoneHalfWidth = 0) {
  const halfWidth = openingHalfWidth(opening, y);
  return halfWidth > 0 && Math.abs(x - opening.centerX) < halfWidth + stoneHalfWidth * 0.35;
}

function tagOpeningGeometry(geometry, opening, door) {
  if (!opening.componentId) return geometry;
  geometry.userData.workshopSemantic = Object.freeze({
    id: opening.componentId,
    label: opening.componentLabel ?? (door ? 'Door' : 'Window'),
    kind: door ? 'door' : 'window',
    hostId: opening.hostId,
    attachmentPosition: Object.freeze([
      opening.surfaceX ?? opening.centerX ?? 0,
      opening.bottom,
    ]),
    attachmentSize: Object.freeze([
      opening.width,
      opening.springHeight + opening.radius,
    ]),
  });
  return geometry;
}

function tagStructureGeometry(geometry, surface) {
  geometry.userData.workshopSemantic = Object.freeze({
    id: surface.id,
    label: surface.label,
    kind: 'structure',
    attachmentSurface: Object.freeze({
      type: surface.type,
      width: surface.width,
      height: surface.height,
      radius: surface.radius ?? 0,
    }),
  });
  return geometry;
}

function addStone(target, recipe, params, stableIndex, heightRatio) {
  const variation = mixSeed(recipe.seed ^ 0x5f3759df, stableIndex);
  const signed = (shift) => (((variation >>> shift) & 255) / 255 - 0.5) * 2;
  const rotation = params.rotation ?? [0, 0, 0];
  const shaped = {
    ...params,
    width: params.width * (1 + signed(0) * 0.018),
    height: params.height * (1 + signed(8) * 0.014),
    depth: params.depth * (1 + signed(16) * 0.022),
    rotation: [
      rotation[0] + signed(4) * 0.006,
      rotation[1] + signed(12) * 0.008,
      rotation[2] + signed(20) * 0.006,
    ],
    bevelRatio: params.bevelRatio ?? (0.048 + ((variation >>> 24) & 15) / 15 * 0.022),
  };
  target.push(applyStoneColor(
    beveledBox({ ...shaped, detail: recipe.detail }),
    recipe,
    stableIndex,
    heightRatio,
  ));
}

function buildWallCourses(recipe, {
  width = recipe.width,
  depth = recipe.depth,
  height = recipe.height,
  centerX = 0,
  centerZ = 0,
  openings = [],
  seedOffset = 0,
  yaw = 0,
} = {}) {
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const geometries = [];
  const courseHeight = 0.5 - recipe.detail * 0.045;
  const courses = Math.max(2, Math.ceil(height / courseHeight));
  const actualCourseHeight = height / courses;
  const targetStoneWidth = 0.94 - recipe.detail * 0.08;
  let stableIndex = seedOffset * 10000;

  for (let course = 0; course < courses; course += 1) {
    const y = (course + 0.5) * actualCourseHeight;
    let cursor = -width / 2;
    let stoneIndex = 0;
    while (cursor < width / 2 - 0.001) {
      const remaining = width / 2 - cursor;
      const bondScale = stoneIndex === 0 && course % 2 === 1 ? 0.56 : 1;
      const desired = targetStoneWidth * bondScale * (0.72 + random() * 0.56);
      const stoneWidth = Math.min(remaining, Math.max(0.28, desired));
      const stoneCenter = cursor + stoneWidth / 2;
      const insideOpening = openings.some((opening) => (
        isInsideOpening(opening, stoneCenter, y, stoneWidth / 2)
      ));
      if (!insideOpening) {
        const inset = 0.014 + random() * 0.016;
        const localX = stoneCenter;
        addStone(geometries, recipe, {
          width: Math.max(0.12, stoneWidth - inset),
          height: Math.max(0.12, actualCourseHeight - inset * 0.72),
          depth: depth * (0.96 + random() * 0.025),
          position: [
            centerX + Math.cos(yaw) * localX,
            y + (random() - 0.5) * 0.028,
            centerZ - Math.sin(yaw) * localX,
          ],
          rotation: [0, yaw + (random() - 0.5) * 0.012, 0],
        }, stableIndex, y / height);
      }
      cursor += stoneWidth;
      stoneIndex += 1;
      stableIndex += 1;
      if (stoneIndex > 256) {
        throw new Error('Workshop stone packing exceeded its safety budget.');
      }
    }
  }
  return geometries;
}

function buildArchTrim(recipe, opening, {
  frontZ,
  seedOffset,
  depth = 0.3,
}) {
  const stones = [];
  const blockHeight = 0.32;
  const jambCourses = Math.max(2, Math.ceil(opening.springHeight / blockHeight));
  const actualJambHeight = opening.springHeight / jambCourses;
  const trimThickness = Math.max(0.2, opening.width * 0.11);
  let stableIndex = seedOffset * 10000;

  for (let course = 0; course < jambCourses; course += 1) {
    const y = opening.bottom + (course + 0.5) * actualJambHeight;
    for (const side of [-1, 1]) {
      addStone(stones, recipe, {
        width: trimThickness,
        height: actualJambHeight * 0.91,
        depth,
        position: [
          opening.centerX + side * (opening.width / 2 + trimThickness * 0.48),
          y,
          frontZ,
        ],
      }, stableIndex, y / recipe.height);
      stableIndex += 1;
    }
  }

  const archBlocks = Math.max(7, Math.ceil(Math.PI * opening.radius / 0.3));
  for (let block = 0; block < archBlocks; block += 1) {
    const angle = (block + 0.5) / archBlocks * Math.PI;
    const ringRadius = opening.radius + trimThickness * 0.5;
    const x = opening.centerX + Math.cos(angle) * ringRadius;
    const y = opening.bottom + opening.springHeight + Math.sin(angle) * ringRadius;
    addStone(stones, recipe, {
      width: Math.PI * ringRadius / archBlocks * 0.92,
      height: trimThickness,
      depth,
      position: [x, y, frontZ],
      rotation: [0, 0, angle - Math.PI / 2],
    }, stableIndex, y / recipe.height);
    stableIndex += 1;
  }
  return stones;
}

function addOpeningDetails(sets, recipe, opening, {
  frontZ,
  seedOffset,
  door = false,
}) {
  sets.stone.push(...buildArchTrim(recipe, opening, { frontZ, seedOffset }));
  const panel = tagOpeningGeometry(archedPanel({
    width: opening.width * 0.91,
    springHeight: opening.springHeight,
    radius: opening.radius * 0.91,
    depth: 0.12,
    position: [opening.centerX, opening.bottom, frontZ - 0.11],
    detail: recipe.detail,
  }), opening, door);
  if (door) {
    sets.wood.push(panel);
    const plankCount = Math.max(3, Math.round(opening.width / 0.32));
    for (let index = 1; index < plankCount; index += 1) {
      const x = opening.centerX - opening.width * 0.455 + index * opening.width * 0.91 / plankCount;
      sets.metal.push(tagOpeningGeometry(beveledBox({
        width: 0.018,
        height: opening.springHeight * 0.92,
        depth: 0.025,
        position: [x, opening.bottom + opening.springHeight * 0.46, frontZ - 0.035],
        detail: 1,
        bevelRatio: 0.05,
      }), opening, door));
    }
    for (const y of [0.35, opening.springHeight * 0.72]) {
      sets.metal.push(tagOpeningGeometry(beveledBox({
        width: opening.width * 0.83,
        height: 0.055,
        depth: 0.035,
        position: [opening.centerX, opening.bottom + y, frontZ - 0.03],
        detail: 1,
        bevelRatio: 0.08,
      }), opening, door));
    }
  } else {
    sets.recess.push(panel);
    sets.wood.push(tagOpeningGeometry(beveledBox({
      width: 0.055,
      height: opening.springHeight * 0.8,
      depth: 0.05,
      position: [
        opening.centerX,
        opening.bottom + opening.springHeight * 0.47,
        frontZ - 0.02,
      ],
      detail: 1,
      bevelRatio: 0.08,
    }), opening, door));
  }
}

function buildBattlementLine(sets, recipe, {
  width,
  depth,
  y,
  centerX = 0,
  centerZ = 0,
  seedOffset,
  yaw = 0,
}) {
  const merlons = Math.max(3, Math.ceil(width / 1.25));
  const spacing = width / merlons;
  let stableIndex = seedOffset * 10000;
  for (let index = 0; index < merlons; index += 1) {
    const localX = -width / 2 + spacing * (index + 0.5);
    addStone(sets.stone, recipe, {
      width: Math.min(0.62, spacing * 0.58),
      height: 0.62,
      depth: depth + 0.2,
      position: [
        centerX + Math.cos(yaw) * localX,
        y + 0.31,
        centerZ - Math.sin(yaw) * localX,
      ],
      rotation: [0, yaw, 0],
    }, stableIndex + index, 1);
  }
  const coping = Math.max(2, Math.ceil(width / 0.7));
  for (let index = 0; index < coping; index += 1) {
    const stoneWidth = width / coping;
    const localX = -width / 2 + stoneWidth * (index + 0.5);
    addStone(sets.stone, recipe, {
      width: stoneWidth * 0.96,
      height: 0.18,
      depth: depth + 0.28,
      position: [
        centerX + Math.cos(yaw) * localX,
        y - 0.09,
        centerZ - Math.sin(yaw) * localX,
      ],
      rotation: [0, yaw, 0],
    }, stableIndex + merlons + index, 1);
  }
}

function towerOpeningAt(opening, angle, radius, y, blockHalfWidth) {
  const tangential = shortAngle(angle - opening.angle) * radius;
  return isInsideOpening(
    { ...opening, centerX: 0 },
    tangential,
    y,
    blockHalfWidth,
  );
}

function buildTowerBody(recipe, {
  radius,
  depth,
  height,
  centerX = 0,
  centerZ = 0,
  seedOffset,
  openings = [],
}) {
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const stones = [];
  const courseHeight = 0.5 - recipe.detail * 0.04;
  const courses = Math.max(3, Math.ceil(height / courseHeight));
  const actualHeight = height / courses;
  const circumference = TAU * radius;
  const blocks = Math.max(12, Math.ceil(circumference / (0.82 - recipe.detail * 0.06)));
  let stableIndex = seedOffset * 10000;

  for (let course = 0; course < courses; course += 1) {
    const phase = (course % 2) * Math.PI / blocks;
    const y = (course + 0.5) * actualHeight;
    for (let block = 0; block < blocks; block += 1) {
      const angle = phase + block / blocks * TAU;
      const blockWidth = circumference / blocks * 0.94;
      if (!openings.some((opening) => (
        towerOpeningAt(opening, angle, radius, y, blockWidth / 2)
      ))) {
        addStone(stones, recipe, {
          width: blockWidth * 1.035,
          height: actualHeight * 0.975,
          depth,
          position: [
            centerX + Math.sin(angle) * radius,
            y + (random() - 0.5) * 0.018,
            centerZ + Math.cos(angle) * radius,
          ],
          rotation: [0, angle, 0],
        }, stableIndex, y / height);
      }
      stableIndex += 1;
    }
  }
  return stones;
}

function buildRoundBattlements(sets, recipe, {
  radius,
  depth,
  height,
  centerX,
  centerZ,
  seedOffset,
}) {
  const count = Math.max(10, Math.ceil(TAU * radius / 1.05));
  let stableIndex = seedOffset * 10000;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU;
    addStone(sets.stone, recipe, {
      width: TAU * radius / count * 0.58,
      height: 0.66,
      depth: depth * 1.12,
      position: [
        centerX + Math.sin(angle) * (radius + depth * 0.08),
        height + 0.33,
        centerZ + Math.cos(angle) * (radius + depth * 0.08),
      ],
      rotation: [0, angle, 0],
    }, stableIndex + index, 1);
  }
  for (let index = 0; index < count * 2; index += 1) {
    const angle = index / (count * 2) * TAU;
    addStone(sets.stone, recipe, {
      width: TAU * radius / (count * 2) * 0.92,
      height: 0.18,
      depth: depth * 1.22,
      position: [
        centerX + Math.sin(angle) * (radius + depth * 0.1),
        height - 0.08,
        centerZ + Math.cos(angle) * (radius + depth * 0.1),
      ],
      rotation: [0, angle, 0],
    }, stableIndex + count + index, 1);
  }
}

function buildMachicolations(sets, recipe, {
  radius,
  depth,
  height,
  centerX,
  centerZ,
  seedOffset,
}) {
  const count = Math.max(12, Math.ceil(TAU * radius / 0.78));
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU;
    addStone(sets.stone, recipe, {
      width: 0.3,
      height: 0.42,
      depth: 0.55,
      position: [
        centerX + Math.sin(angle) * (radius + depth * 0.46),
        height - 0.18,
        centerZ + Math.cos(angle) * (radius + depth * 0.46),
      ],
      rotation: [0, angle, 0],
    }, seedOffset * 10000 + index, 0.96);
  }
}

function addTowerTop(sets, recipe, {
  radius,
  depth,
  height,
  centerX,
  centerZ,
  seedOffset,
}) {
  buildMachicolations(sets, recipe, {
    radius,
    depth,
    height,
    centerX,
    centerZ,
    seedOffset: seedOffset + 10,
  });
  let flagBase = height + 0.7;
  if (recipe.topStyle === 'battlements') {
    buildRoundBattlements(sets, recipe, {
      radius,
      depth,
      height,
      centerX,
      centerZ,
      seedOffset: seedOffset + 20,
    });
  } else {
    const roofHeight = Math.min(5.2, Math.max(0.9, radius * 1.25 * recipe.roofScale));
    sets.roof.push(coneRoof({
      radius: radius + depth * 0.52 + recipe.roofOverhang,
      height: roofHeight,
      y: height + 0.06,
      centerX,
      centerZ,
      sides: recipe.detail === 3 ? 28 : 20,
    }));
    sets.roof.push(cylinder({
      radius: radius + depth * 0.9,
      height: 0.12,
      position: [centerX, height + 0.05, centerZ],
      sides: recipe.detail === 3 ? 28 : 20,
    }));
    flagBase = height + roofHeight + 0.08;
  }
  sets.metal.push(cylinder({
    radius: 0.035,
    height: 1.45,
    position: [centerX, flagBase + 0.72, centerZ],
    sides: 8,
  }));
  sets.metal.push(flagGeometry({
    width: 0.9,
    height: 0.42,
    position: [centerX + 0.03, flagBase + 1.12, centerZ],
  }));
}

function towerOpenings(recipe, height, {
  includeDoor,
  doorId = 'door-1',
  windowId = 'window-1',
  hostId = 'structure-main',
} = {}) {
  const openings = [];
  if (includeDoor) {
    const width = Math.min(1.45, recipe.width * 0.26);
    openings.push({
      centerX: 0,
      angle: 0,
      bottom: 0,
      width,
      springHeight: Math.min(1.8, height * 0.3),
      radius: width / 2,
      door: true,
      componentId: doorId,
      componentLabel: 'Door',
      hostId,
    });
  }
  if (recipe.windows && height >= 3.6) {
    openings.push({
      centerX: 0,
      angle: 0,
      bottom: height * 0.52,
      width: 0.55,
      springHeight: 0.72,
      radius: 0.275,
      door: false,
      componentId: windowId,
      componentLabel: 'Window',
      hostId,
    });
  }
  return openings;
}

function addTowerOpeningDetails(sets, recipe, openings, {
  centerX,
  centerZ,
  radius,
  depth,
  seedOffset,
}) {
  const frontZ = centerZ + radius + depth * 0.55;
  openings.forEach((opening, index) => {
    const starts = Object.fromEntries(Object.entries(sets).map(([slot, geometries]) => (
      [slot, geometries.length]
    )));
    addOpeningDetails(sets, recipe, {
      ...opening,
      centerX,
    }, {
      frontZ,
      seedOffset: seedOffset + index,
      door: opening.door,
    });
    if (Math.abs(opening.angle ?? 0) > 1e-7) {
      const matrix = new THREE.Matrix4()
        .makeTranslation(centerX, 0, centerZ)
        .multiply(new THREE.Matrix4().makeRotationY(opening.angle))
        .multiply(new THREE.Matrix4().makeTranslation(-centerX, 0, -centerZ));
      for (const [slot, geometries] of Object.entries(sets)) {
        for (let geometryIndex = starts[slot]; geometryIndex < geometries.length; geometryIndex += 1) {
          geometries[geometryIndex].applyMatrix4(matrix);
        }
      }
    }
  });
}

function buildIvy(sets, recipe, {
  width,
  height,
  frontZ,
  centerX = 0,
  seedOffset,
}) {
  if (!recipe.ivy) return;
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const clusters = 18 + recipe.detail * 7;
  const side = random() < 0.5 ? -1 : 1;
  let previous = null;
  for (let index = 0; index < clusters; index += 1) {
    const rise = index / Math.max(1, clusters - 1);
    const x = centerX + side * width * (0.34 + random() * 0.12)
      + Math.sin(rise * 8 + seedOffset) * width * 0.05;
    const y = 0.2 + rise * height * (0.55 + random() * 0.25);
    if (previous && index % 2 === 0) {
      const deltaX = x - previous.x;
      const deltaY = y - previous.y;
      const length = Math.hypot(deltaX, deltaY);
      sets.foliage.push(beveledBox({
        width: 0.035,
        height: Math.max(0.08, length),
        depth: 0.035,
        position: [(x + previous.x) / 2, (y + previous.y) / 2, frontZ + 0.035],
        rotation: [0, 0, -Math.atan2(deltaX, deltaY)],
        detail: 1,
        bevelRatio: 0.08,
      }));
    }
    sets.foliage.push(leaf({
      radius: 0.1 + random() * 0.075,
      position: [x, y, frontZ + 0.025 + random() * 0.025],
      rotation: [random() * 0.8, random() * 0.4, random() * Math.PI],
    }));
    previous = { x, y };
  }
}

function createEmptySets() {
  return {
    stone: [],
    mortar: [],
    wood: [],
    roof: [],
    metal: [],
    foliage: [],
    recess: [],
  };
}

function buildWall(recipe) {
  const sets = createEmptySets();
  const host = {
    id: 'structure-main',
    label: 'Main wall',
    type: 'planar',
    width: recipe.width,
    height: recipe.height,
  };
  const baseOpenings = recipe.windows && recipe.height >= 3.4
    ? [-1, 1].map((side, index) => ({
      centerX: side * recipe.width * 0.23,
      bottom: recipe.height * 0.43,
      width: 0.44,
      springHeight: 0.64,
      radius: 0.22,
      componentId: `window-${index + 1}`,
      componentLabel: `Window ${index + 1}`,
      hostId: host.id,
    }))
    : [];
  const openings = resolveWorkshopOpeningLayout(recipe, baseOpenings, [host]).get(host.id);
  sets.stone.push(...buildWallCourses(recipe, { openings, seedOffset: 10 }));
  sets.mortar.push(tagStructureGeometry(beveledBox({
    width: recipe.width * 0.995,
    height: recipe.height * 0.995,
    depth: recipe.depth * 0.86,
    position: [0, recipe.height / 2, 0],
    detail: 1,
    bevelRatio: 0.012,
  }), host));
  openings.forEach((opening, index) => {
    addOpeningDetails(sets, recipe, opening, {
      frontZ: recipe.depth / 2 + 0.07,
      seedOffset: 30 + index,
    });
  });
  if (recipe.topStyle === 'battlements') {
    buildBattlementLine(sets, recipe, {
      width: recipe.width,
      depth: recipe.depth,
      y: recipe.height,
      seedOffset: 50,
    });
  } else {
    sets.roof.push(...wallRoofPlanes({
      width: recipe.width,
      depth: recipe.depth,
      y: recipe.height,
      height: Math.min(3.8, recipe.depth * 0.65 * recipe.roofScale),
      detail: recipe.detail,
      overhang: recipe.roofOverhang,
    }));
  }
  buildIvy(sets, recipe, {
    width: recipe.width,
    height: recipe.height,
    frontZ: recipe.depth / 2,
    seedOffset: 60,
  });
  return sets;
}

function buildTower(recipe) {
  const sets = createEmptySets();
  const depth = Math.max(0.5, recipe.depth * 0.58);
  const radius = Math.max(1, recipe.width / 2 - depth * 0.22);
  const host = {
    id: 'structure-main',
    label: 'Round tower',
    type: 'round',
    width: Math.PI * 2 * radius,
    height: recipe.height,
    radius,
  };
  const baseOpenings = towerOpenings(recipe, recipe.height, {
    includeDoor: recipe.windows,
    hostId: host.id,
  });
  const openings = resolveWorkshopOpeningLayout(recipe, baseOpenings, [host]).get(host.id);
  sets.stone.push(...buildTowerBody(recipe, {
    radius,
    depth,
    height: recipe.height,
    seedOffset: 100,
    openings,
  }));
  sets.mortar.push(tagStructureGeometry(cylinder({
    radius: Math.max(0.2, radius - depth * 0.46),
    height: recipe.height * 0.995,
    position: [0, recipe.height / 2, 0],
    sides: recipe.detail === 3 ? 64 : 48,
  }), host));
  addTowerOpeningDetails(sets, recipe, openings, {
    centerX: 0,
    centerZ: 0,
    radius,
    depth,
    seedOffset: 120,
  });
  addTowerTop(sets, recipe, {
    radius,
    depth,
    height: recipe.height,
    centerX: 0,
    centerZ: 0,
    seedOffset: 140,
  });
  buildIvy(sets, recipe, {
    width: radius * 1.6,
    height: recipe.height,
    frontZ: radius + depth * 0.56,
    seedOffset: 170,
  });
  return sets;
}

function addSquareTowerTop(sets, recipe, {
  width,
  depth,
  wallThickness,
  height,
}) {
  let flagBase = height + 0.7;
  if (recipe.topStyle === 'battlements') {
    const edges = [
      { edgeWidth: width, centerX: 0, centerZ: depth / 2, yaw: 0 },
      { edgeWidth: width, centerX: 0, centerZ: -depth / 2, yaw: 0 },
      { edgeWidth: depth, centerX: width / 2, centerZ: 0, yaw: Math.PI / 2 },
      { edgeWidth: depth, centerX: -width / 2, centerZ: 0, yaw: Math.PI / 2 },
    ];
    edges.forEach((edge, index) => {
      buildBattlementLine(sets, recipe, {
        width: edge.edgeWidth,
        depth: wallThickness + 0.12,
        y: height,
        centerX: edge.centerX,
        centerZ: edge.centerZ,
        yaw: edge.yaw,
        seedOffset: 580 + index * 10,
      });
    });
  } else {
    const roofHeight = Math.min(5, Math.max(0.9, width * 0.38 * recipe.roofScale));
    const roof = coneRoof({
      radius: width / Math.sqrt(2) + recipe.roofOverhang,
      height: roofHeight,
      y: height + 0.06,
      sides: 4,
      rotationY: Math.PI / 4,
    });
    roof.scale(1, 1, depth / width);
    sets.roof.push(roof);
    sets.roof.push(beveledBox({
      width: width + recipe.roofOverhang * 2,
      height: 0.13,
      depth: depth + recipe.roofOverhang * 2,
      position: [0, height + 0.04, 0],
      detail: 2,
      bevelRatio: 0.16,
    }));
    flagBase = height + roofHeight + 0.08;
  }
  sets.metal.push(cylinder({
    radius: 0.035,
    height: 1.45,
    position: [0, flagBase + 0.72, 0],
    sides: 8,
  }));
  sets.metal.push(flagGeometry({
    width: 0.9,
    height: 0.42,
    position: [0.03, flagBase + 1.12, 0],
  }));
}

function buildSquareTower(recipe) {
  const sets = createEmptySets();
  const width = recipe.width;
  const depth = Math.max(2.8, Math.min(recipe.width * 0.82, recipe.depth * 2.3));
  const wallThickness = Math.max(0.46, Math.min(0.82, recipe.depth * 0.34));
  const host = {
    id: 'structure-main',
    label: 'Square tower',
    type: 'planar',
    width,
    height: recipe.height,
  };
  const baseOpenings = recipe.windows
    ? [
      {
        centerX: 0,
        bottom: 0,
        width: Math.min(1.45, width * 0.27),
        springHeight: Math.min(1.85, recipe.height * 0.28),
        radius: Math.min(0.725, width * 0.135),
        door: true,
        componentId: 'door-1',
        componentLabel: 'Door',
        hostId: host.id,
      },
      ...(recipe.height >= 4.4 ? [{
        centerX: 0,
        bottom: recipe.height * 0.54,
        width: 0.58,
        springHeight: 0.78,
        radius: 0.29,
        door: false,
        componentId: 'window-1',
        componentLabel: 'Window',
        hostId: host.id,
      }] : []),
    ]
    : [];
  const openings = resolveWorkshopOpeningLayout(recipe, baseOpenings, [host]).get(host.id);

  sets.stone.push(
    ...buildWallCourses(recipe, {
      width,
      depth: wallThickness,
      height: recipe.height,
      centerZ: depth / 2,
      openings,
      seedOffset: 500,
    }),
    ...buildWallCourses(recipe, {
      width,
      depth: wallThickness,
      height: recipe.height,
      centerZ: -depth / 2,
      seedOffset: 510,
    }),
    ...buildWallCourses(recipe, {
      width: depth,
      depth: wallThickness,
      height: recipe.height,
      centerX: width / 2,
      yaw: Math.PI / 2,
      seedOffset: 520,
    }),
    ...buildWallCourses(recipe, {
      width: depth,
      depth: wallThickness,
      height: recipe.height,
      centerX: -width / 2,
      yaw: Math.PI / 2,
      seedOffset: 530,
    }),
  );
  sets.mortar.push(tagStructureGeometry(beveledBox({
    width: width - wallThickness * 0.76,
    height: recipe.height * 0.995,
    depth: depth - wallThickness * 0.76,
    position: [0, recipe.height / 2, 0],
    detail: 1,
    bevelRatio: 0.01,
  }), host));
  openings.forEach((opening, index) => {
    addOpeningDetails(sets, recipe, opening, {
      frontZ: depth / 2 + wallThickness * 0.56,
      seedOffset: 550 + index,
      door: opening.door,
    });
  });
  addSquareTowerTop(sets, recipe, {
    width,
    depth,
    wallThickness,
    height: recipe.height,
  });
  buildIvy(sets, recipe, {
    width,
    height: recipe.height,
    frontZ: depth / 2 + wallThickness * 0.56,
    seedOffset: 640,
  });
  return sets;
}

function buildGatehouse(recipe) {
  const sets = createEmptySets();
  const gateWidth = Math.min(recipe.width * 0.32, 2.8);
  const towerDepth = Math.max(0.48, recipe.depth * 0.55);
  const towerRadius = Math.max(1.05, recipe.depth * 0.72);
  const towerHeight = recipe.height * 1.16;
  const hosts = [
    {
      id: 'structure-main',
      label: 'Gatehouse wall',
      type: 'planar',
      width: recipe.width,
      height: recipe.height,
    },
    ...[-1, 1].map((side) => ({
      id: side < 0 ? 'structure-left' : 'structure-right',
      label: side < 0 ? 'Left tower' : 'Right tower',
      type: 'round',
      width: Math.PI * 2 * towerRadius,
      height: towerHeight,
      radius: towerRadius,
    })),
  ];
  const baseOpenings = recipe.windows ? [{
    centerX: 0,
    bottom: 0,
    width: gateWidth,
    springHeight: Math.min(2.15, recipe.height * 0.46),
    radius: gateWidth / 2,
    door: true,
    componentId: 'door-1',
    componentLabel: 'Gate',
    hostId: 'structure-main',
  }] : [];
  for (const [index, hostId] of ['structure-left', 'structure-right'].entries()) {
    baseOpenings.push(...towerOpenings(recipe, towerHeight, {
      includeDoor: false,
      windowId: `window-${index + 1}`,
      hostId,
    }));
  }
  const openingsByHost = resolveWorkshopOpeningLayout(recipe, baseOpenings, hosts);
  const mainOpenings = openingsByHost.get('structure-main');
  sets.stone.push(...buildWallCourses(recipe, {
    openings: mainOpenings,
    seedOffset: 200,
  }));
  sets.mortar.push(tagStructureGeometry(beveledBox({
    width: recipe.width * 0.995,
    height: recipe.height * 0.995,
    depth: recipe.depth * 0.86,
    position: [0, recipe.height / 2, 0],
    detail: 1,
    bevelRatio: 0.012,
  }), hosts[0]));
  mainOpenings.forEach((opening, index) => {
    addOpeningDetails(sets, recipe, opening, {
      frontZ: recipe.depth / 2 + 0.08,
      seedOffset: 220 + index,
      door: opening.door,
    });
  });
  buildBattlementLine(sets, recipe, {
    width: recipe.width,
    depth: recipe.depth,
    y: recipe.height,
    seedOffset: 240,
  });

  for (const [index, side] of [-1, 1].entries()) {
    const centerX = side * recipe.width * 0.39;
    const host = hosts[index + 1];
    const openings = openingsByHost.get(host.id);
    sets.stone.push(...buildTowerBody(recipe, {
      radius: towerRadius,
      depth: towerDepth,
      height: towerHeight,
      centerX,
      seedOffset: 260 + index * 80,
      openings,
    }));
    sets.mortar.push(tagStructureGeometry(cylinder({
      radius: Math.max(0.2, towerRadius - towerDepth * 0.46),
      height: towerHeight * 0.995,
      position: [centerX, towerHeight / 2, 0],
      sides: recipe.detail === 3 ? 64 : 48,
    }), host));
    addTowerOpeningDetails(sets, recipe, openings, {
      centerX,
      centerZ: 0,
      radius: towerRadius,
      depth: towerDepth,
      seedOffset: 280 + index * 80,
    });
    addTowerTop(sets, recipe, {
      radius: towerRadius,
      depth: towerDepth,
      height: towerHeight,
      centerX,
      centerZ: 0,
      seedOffset: 300 + index * 80,
    });
  }
  buildIvy(sets, recipe, {
    width: recipe.width,
    height: recipe.height,
    frontZ: recipe.depth / 2,
    seedOffset: 450,
  });
  return sets;
}

function addRoofCourseLips(sets, recipe, {
  width,
  depth,
  y,
  height,
  centerX = 0,
  centerZ = 0,
}) {
  const roofDepth = depth + recipe.roofOverhang * 2;
  const angle = Math.atan2(height, roofDepth / 2);
  const rows = Math.max(5, Math.round(height * 3.2));
  for (const side of [-1, 1]) {
    for (let row = 1; row < rows; row += 1) {
      const progress = row / rows;
      sets.roof.push(beveledBox({
        width: width + recipe.roofOverhang * 2.03,
        height: 0.045,
        depth: 0.105,
        position: [
          centerX,
          y + height * progress + 0.045,
          centerZ + side * roofDepth / 2 * (1 - progress),
        ],
        rotation: [side > 0 ? angle : -angle, 0, 0],
        detail: 1,
        bevelRatio: 0.12,
      }));
    }
  }
  sets.roof.push(cylinder({
    radius: 0.095,
    height: width + recipe.roofOverhang * 2.12,
    position: [centerX, y + height + 0.08, centerZ],
    sides: 10,
    rotation: [0, 0, Math.PI / 2],
  }));
}

function addSteppedGableCoping(sets, recipe, {
  endX,
  depth,
  y,
  height,
  seedOffset,
}) {
  if (recipe.shape === 'classic') return;
  const steps = Math.max(5, Math.ceil(height / 0.38));
  let stableIndex = seedOffset * 10000;
  for (const side of [-1, 1]) {
    for (let step = 0; step < steps; step += 1) {
      const progress = (step + 0.5) / steps;
      const blockHeight = height / steps;
      const z = side * depth / 2 * (1 - progress);
      addStone(sets.stone, recipe, {
        width: 0.34,
        height: blockHeight * 0.92,
        depth: Math.max(0.34, depth / steps * 0.94),
        position: [endX, y + blockHeight * (step + 0.5), z],
      }, stableIndex, 0.9 + progress * 0.1);
      stableIndex += 1;
    }
  }
}

function addFlowerBox(sets, recipe, {
  x,
  y,
  z,
  seedOffset,
}) {
  sets.wood.push(beveledBox({
    width: 0.72,
    height: 0.16,
    depth: 0.25,
    position: [x, y, z],
    detail: 2,
    bevelRatio: 0.16,
  }));
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  for (let index = 0; index < 7; index += 1) {
    sets.foliage.push(leaf({
      radius: 0.075 + random() * 0.035,
      position: [
        x - 0.28 + index * 0.093,
        y + 0.13 + random() * 0.11,
        z + 0.04 + random() * 0.08,
      ],
      rotation: [random(), random(), random() * Math.PI],
    }));
  }
}

function createManorFacadeOpenings(recipe, width, height, hasTower, hostId = 'structure-main') {
  if (!recipe.windows) return [];
  const bayCount = Math.max(3, Math.min(6, Math.round(width / 1.8)));
  const bayWidth = width / bayCount;
  const doorBay = Math.max(0, Math.floor((bayCount - 1) / 2));
  const floorCount = Math.max(2, Math.min(4, Math.round(height / 2.7)));
  const firstWindowId = hasTower ? 2 : 1;
  let windowIndex = firstWindowId;
  const doorWidth = Math.min(1.35, bayWidth * 0.68);
  const openings = [{
    centerX: -width / 2 + bayWidth * (doorBay + 0.5),
    bottom: 0,
    width: doorWidth,
    springHeight: Math.min(1.85, height * 0.34),
    radius: doorWidth / 2,
    door: true,
    componentId: 'door-1',
    componentLabel: 'Main entrance',
    hostId,
  }];
  for (let floor = 1; floor < floorCount; floor += 1) {
    for (let bay = 0; bay < bayCount; bay += 1) {
      const currentWindow = windowIndex;
      windowIndex += 1;
      const openingWidth = Math.min(0.78, bayWidth * 0.48);
      openings.push({
        centerX: -width / 2 + bayWidth * (bay + 0.5),
        bottom: height * (floor / floorCount) - Math.min(0.42, height * 0.055),
        width: openingWidth,
        springHeight: Math.min(0.82, height / floorCount * 0.34),
        radius: openingWidth * 0.36,
        door: false,
        componentId: `window-${currentWindow}`,
        componentLabel: `Window ${currentWindow}`,
        hostId,
      });
    }
  }
  return openings;
}

function buildManor(recipe) {
  const sets = createEmptySets();
  const width = recipe.width;
  const depth = Math.max(3.2, Math.min(7.5, recipe.depth * 2.2));
  const height = recipe.height;
  const roofHeight = Math.min(5.4, Math.max(0.85, depth * 0.47 * recipe.roofScale));
  const wallDepth = 0.34;
  const hasTower = recipe.towerSide !== 'none';
  const towerSide = recipe.towerSide === 'left' ? -1 : 1;
  const towerRadius = Math.max(1.25, Math.min(2.15, width * 0.22));
  const towerHeight = Math.min(13.2, height * 1.2);
  const towerX = towerSide * (width / 2 - towerRadius * 0.42);
  const towerZ = depth * 0.32;
  const towerHostId = towerSide < 0 ? 'structure-left' : 'structure-right';
  const hosts = [{
    id: 'structure-main',
    label: 'Main house wall',
    type: 'planar',
    width,
    height,
  }];
  if (hasTower) {
    hosts.push({
      id: towerHostId,
      label: towerSide < 0 ? 'Left tower' : 'Right tower',
      type: 'round',
      width: Math.PI * 2 * towerRadius,
      height: towerHeight,
      radius: towerRadius,
    });
  }
  const mainBaseOpenings = createManorFacadeOpenings(recipe, width, height, hasTower);
  const mainWindowCount = mainBaseOpenings.filter((opening) => !opening.door).length;
  const towerBaseOpenings = recipe.windows && hasTower
    ? [
      {
        centerX: 0,
        bottom: towerHeight * 0.31,
        width: 0.56,
        springHeight: 0.68,
        radius: 0.22,
        componentId: 'window-1',
        componentLabel: 'Tower window 1',
        hostId: towerHostId,
      },
      {
        centerX: 0,
        bottom: towerHeight * 0.63,
        width: 0.52,
        springHeight: 0.64,
        radius: 0.2,
        componentId: `window-${mainWindowCount + 2}`,
        componentLabel: 'Tower window 2',
        hostId: towerHostId,
      },
    ]
    : [];
  const openingsByHost = resolveWorkshopOpeningLayout(
    recipe,
    [...mainBaseOpenings, ...towerBaseOpenings],
    hosts,
  );

  sets.mortar.push(tagStructureGeometry(beveledBox({
    width,
    height,
    depth,
    position: [0, height / 2, 0],
    detail: recipe.detail,
    bevelRatio: 0.018,
  }), hosts[0]));
  sets.mortar.push(
    gablePanel({
      width: depth,
      height: roofHeight * 0.98,
      depth: wallDepth,
      position: [width / 2 - wallDepth * 0.35, height, 0],
      rotation: [0, Math.PI / 2, 0],
    }),
    gablePanel({
      width: depth,
      height: roofHeight * 0.98,
      depth: wallDepth,
      position: [-width / 2 + wallDepth * 0.35, height, 0],
      rotation: [0, Math.PI / 2, 0],
    }),
  );

  sets.stone.push(...buildWallCourses(recipe, {
    width,
    depth: 0.36,
    height: 0.62,
    centerZ: depth / 2 + 0.06,
    seedOffset: 710,
  }));

  const openings = openingsByHost.get('structure-main');
  openings.forEach((opening, index) => {
    addOpeningDetails(sets, recipe, opening, {
      frontZ: depth / 2 + 0.2,
      seedOffset: 730 + index,
      door: opening.door,
    });
    if (!opening.door) {
      addFlowerBox(sets, recipe, {
        x: opening.centerX,
        y: opening.bottom - 0.08,
        z: depth / 2 + 0.39,
        seedOffset: 750 + index,
      });
    }
  });

  sets.roof.push(...wallRoofPlanes({
    width,
    depth,
    y: height,
    height: roofHeight,
    detail: recipe.detail,
    overhang: recipe.roofOverhang,
  }));
  addRoofCourseLips(sets, recipe, {
    width,
    depth,
    y: height,
    height: roofHeight,
  });
  for (const endX of [-width / 2 - 0.04, width / 2 + 0.04]) {
    addSteppedGableCoping(sets, recipe, {
      endX,
      depth: depth + 0.08,
      y: height,
      height: roofHeight,
      seedOffset: endX < 0 ? 770 : 780,
    });
  }

  if (hasTower) {
    const tapered = recipe.shape === 'tapered';
    sets.mortar.push(tagStructureGeometry(cylinder({
      radius: towerRadius,
      radiusTop: tapered ? towerRadius * 0.87 : towerRadius,
      radiusBottom: towerRadius * 1.02,
      height: towerHeight,
      position: [towerX, towerHeight / 2, towerZ],
      sides: recipe.detail === 3 ? 48 : 36,
    }), hosts[1]));
    const towerOpeningsList = openingsByHost.get(towerHostId);
    addTowerOpeningDetails(sets, recipe, towerOpeningsList, {
      centerX: towerX,
      centerZ: towerZ,
      radius: towerRadius,
      depth: 0.18,
      seedOffset: 800,
    });
    const towerRoofHeight = Math.min(6.2, roofHeight * 1.4);
    sets.roof.push(
      coneRoof({
        radius: towerRadius + recipe.roofOverhang,
        height: towerRoofHeight,
        y: towerHeight + 0.04,
        centerX: towerX,
        centerZ: towerZ,
        sides: recipe.detail === 3 ? 40 : 28,
      }),
      cylinder({
        radius: towerRadius + recipe.roofOverhang * 1.04,
        height: 0.11,
        position: [towerX, towerHeight + 0.04, towerZ],
        sides: recipe.detail === 3 ? 40 : 28,
      }),
    );
    sets.metal.push(cylinder({
      radius: 0.028,
      height: 0.72,
      position: [towerX, towerHeight + towerRoofHeight + 0.36, towerZ],
      sides: 8,
    }));
  }

  buildIvy(sets, recipe, {
    width,
    height,
    frontZ: depth / 2 + 0.22,
    centerX: 0,
    seedOffset: 830,
  });
  return sets;
}

function createGeometrySets(recipe) {
  if (recipe.archetype === 'wall') return buildWall(recipe);
  if (recipe.archetype === 'tower') return buildTower(recipe);
  if (recipe.archetype === 'square-tower') return buildSquareTower(recipe);
  if (recipe.archetype === 'manor') return buildManor(recipe);
  return buildGatehouse(recipe);
}

function createPartsForSet(geometries, material, remesh) {
  if (geometries.length === 0) {
    for (const value of Object.values(material)) {
      if (value?.isTexture) value.dispose();
    }
    material.dispose();
    return [];
  }
  if (!remesh) {
    return geometries.map((geometry) => ({
      geometry,
      material,
      matrix: new THREE.Matrix4(),
    }));
  }
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  if (!merged) {
    material.dispose();
    throw new Error('The workshop could not merge the generated geometry.');
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return [{ geometry: merged, material, matrix: new THREE.Matrix4() }];
}

function buildParts(recipe, sets) {
  const materials = createWorkshopMaterials(recipe);
  return [
    ...createPartsForSet(sets.stone, materials.stone, recipe.remesh),
    ...createPartsForSet(sets.mortar, materials.mortar, recipe.remesh),
    ...createPartsForSet(sets.wood, materials.wood, recipe.remesh),
    ...createPartsForSet(sets.roof, materials.roof, recipe.remesh),
    ...createPartsForSet(sets.metal, materials.metal, recipe.remesh),
    ...createPartsForSet(sets.foliage, materials.foliage, recipe.remesh),
    ...createPartsForSet(sets.recess, materials.recess, recipe.remesh),
  ];
}

function buildStats(recipe, sets) {
  const allGeometry = Object.values(sets).flat();
  const populatedSets = Object.values(sets).filter((geometries) => geometries.length > 0);
  return Object.freeze({
    stones: sets.stone.length,
    features: allGeometry.length - sets.stone.length,
    sourceVertices: allGeometry.reduce(
      (sum, geometry) => sum + geometry.getAttribute('position').count,
      0,
    ),
    drawParts: recipe.remesh ? populatedSets.length : allGeometry.length,
  });
}

export function createProceduralMedievalParts(input) {
  const recipe = normalizeProceduralRecipe(input);
  const sets = createGeometrySets(recipe);
  const stats = buildStats(recipe, sets);
  const parts = buildParts(recipe, sets);
  Object.defineProperty(parts, 'stats', { value: stats, enumerable: false });
  return Object.freeze(parts);
}

export function getProceduralRecipeStats(input) {
  const recipe = normalizeProceduralRecipe(input);
  const sets = createGeometrySets(recipe);
  const stats = buildStats(recipe, sets);
  Object.values(sets).flat().forEach((geometry) => geometry.dispose());
  return stats;
}
