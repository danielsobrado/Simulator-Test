import * as THREE from 'three';
import {
  applyCylindricalUv,
  applyProjectedUv,
  getSurfaceMaterial,
  surfaceDensity,
} from './assets/proceduralSurfaces.js';

/**
 * Procedural object models.
 *
 * Every model is assembled from primitives whose UVs are projected at a
 * consistent texel density and shaded with the shared procedural surface
 * materials, so a cottage reads as plaster, timber, and thatch rather than
 * flat-coloured boxes. Dimensions are expressed as multiples of the tile size
 * so models keep their proportions if the map scale changes.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function compose(position, rotation, scale) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    scale ? new THREE.Vector3(...scale) : UNIT_SCALE,
  );
}

function part(geometry, surface, tint, position, rotation = [0, 0, 0], scale = null) {
  return {
    geometry,
    material: getSurfaceMaterial(surface, tint),
    matrix: compose(position, rotation, scale),
  };
}

function box(width, height, depth, surface, tint, position, rotation) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  applyProjectedUv(geometry, surfaceDensity(surface));
  return part(geometry, surface, tint, position, rotation);
}

function cylinder(radiusTop, radiusBottom, height, sides, surface, tint, position, rotation) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides);
  applyCylindricalUv(geometry, surfaceDensity(surface), Math.max(radiusTop, radiusBottom), height);
  return part(geometry, surface, tint, position, rotation);
}

function cone(radius, height, sides, surface, tint, position, rotation) {
  const geometry = new THREE.ConeGeometry(radius, height, sides);
  applyCylindricalUv(geometry, surfaceDensity(surface), radius, height);
  return part(geometry, surface, tint, position, rotation);
}

function blob(radius, surface, tint, position, scale, rotation = [0, 0, 0]) {
  const geometry = new THREE.SphereGeometry(radius, 10, 8);
  applyCylindricalUv(geometry, surfaceDensity(surface), radius, radius * 2);
  return part(geometry, surface, tint, position, rotation, scale);
}

function stone(radius, surface, tint, position, rotation, scale) {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  applyProjectedUv(geometry, surfaceDensity(surface));
  return part(geometry, surface, tint, position, rotation, scale);
}

/**
 * Two slanted slabs meeting at a ridge. Reads far better than a four-sided cone
 * for rectangular buildings and gives the roof surface a long run to tile over.
 */
function gableRoof({
  width,
  depth,
  height,
  surface,
  tint,
  center = [0, 0],
  base,
  thickness,
  overhang = 0,
  yaw = 0,
}) {
  const halfSpan = depth / 2 + overhang;
  const slope = Math.hypot(halfSpan, height);
  const pitch = Math.atan2(height, halfSpan);
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw);
  const parts = [];

  for (const side of [1, -1]) {
    const geometry = new THREE.BoxGeometry(width + overhang * 2, thickness, slope);
    applyProjectedUv(geometry, surfaceDensity(surface));

    const offset = new THREE.Vector3(0, base + height / 2, (side * halfSpan) / 2)
      .applyQuaternion(yawQuaternion)
      .add(new THREE.Vector3(center[0], 0, center[1]));
    const quaternion = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(side * pitch, 0, 0))
      .premultiply(yawQuaternion);

    parts.push({
      geometry,
      material: getSurfaceMaterial(surface, tint),
      matrix: new THREE.Matrix4().compose(offset, quaternion, UNIT_SCALE),
    });
  }
  return parts;
}

/** Corner posts, fence pickets, and other evenly repeated uprights. */
function uprights(positions, width, height, surface, tint, base) {
  return positions.map(([x, z]) => box(
    width,
    height,
    width,
    surface,
    tint,
    [x, base + height / 2, z],
  ));
}

function cottage(size) {
  const width = size * 1.55;
  const depth = size * 1.4;
  const plinth = size * 0.14;
  const wall = size * 0.78;
  const wallTop = plinth + wall;
  const roofHeight = size * 0.66;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  return [
    box(width * 1.06, plinth, depth * 1.06, 'rubble', null, [0, plinth / 2, 0]),
    box(width, wall, depth, 'plaster', '#e7ddc4', [0, plinth + wall / 2, 0]),
    box(width * 1.01, size * 0.09, depth * 1.01, 'timber', '#5d3f26', [0, plinth + wall * 0.54, 0]),
    ...uprights(
      [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [-halfWidth, halfDepth], [halfWidth, halfDepth]],
      size * 0.12,
      wall,
      'timber',
      '#4d3320',
      plinth,
    ),
    ...gableRoof({
      width,
      depth,
      height: roofHeight,
      surface: 'thatch',
      tint: null,
      base: wallTop,
      thickness: size * 0.16,
      overhang: size * 0.16,
    }),
    box(width * 1.08, size * 0.13, size * 0.18, 'thatch', '#a8842f', [0, wallTop + roofHeight, 0]),
    box(size * 0.34, size * 0.52, size * 0.07, 'plank', '#6b4526', [0, plinth + size * 0.26, halfDepth]),
    box(size * 0.28, size * 0.26, size * 0.06, 'window', null, [-size * 0.48, plinth + wall * 0.6, halfDepth]),
    box(size * 0.28, size * 0.26, size * 0.06, 'window', null, [size * 0.48, plinth + wall * 0.6, halfDepth]),
    box(size * 0.24, size * 1.12, size * 0.24, 'rubble', '#8f8579', [halfWidth * 0.62, size * 0.62, -halfDepth * 0.5]),
  ];
}

function farmstead(size) {
  const barnWidth = size * 1.2;
  const barnDepth = size * 1.12;
  const barnWall = size * 0.78;
  const barnX = -size * 0.6;
  const barnZ = -size * 0.55;
  const fieldX = size * 0.62;

  const rows = [-0.62, -0.2, 0.22, 0.64].map((offset) => box(
    size * 0.9,
    size * 0.2,
    size * 0.2,
    'crop',
    null,
    [fieldX, size * 0.16, size * offset],
  ));

  return [
    box(size * 2.7, size * 0.08, size * 2.7, 'soil', null, [0, size * 0.04, 0]),
    ...rows,
    box(barnWidth * 1.06, size * 0.1, barnDepth * 1.06, 'rubble', null, [barnX, size * 0.05, barnZ]),
    box(barnWidth, barnWall, barnDepth, 'plank', '#a8492f', [barnX, size * 0.1 + barnWall / 2, barnZ]),
    ...gableRoof({
      width: barnWidth,
      depth: barnDepth,
      height: size * 0.52,
      surface: 'shingle',
      tint: null,
      center: [barnX, barnZ],
      base: size * 0.1 + barnWall,
      thickness: size * 0.12,
      overhang: size * 0.12,
    }),
    box(size * 0.42, size * 0.56, size * 0.07, 'timber', '#4f351f', [barnX, size * 0.38, barnZ + barnDepth / 2]),
    ...uprights(
      [[-size * 1.28, size * 1.28], [size * 0, size * 1.28], [size * 1.28, size * 1.28]],
      size * 0.1,
      size * 0.42,
      'timber',
      '#6a4a2c',
      size * 0.08,
    ),
    box(size * 2.6, size * 0.07, size * 0.07, 'timber', '#6a4a2c', [0, size * 0.4, size * 1.28]),
    blob(size * 0.4, 'thatch', null, [-size * 1.0, size * 0.32, size * 0.75], [1.1, 0.78, 1.1]),
  ];
}

function inn(size) {
  const width = size * 2.35;
  const depth = size * 1.45;
  const plinth = size * 0.16;
  const ground = size * 0.82;
  const upper = size * 0.66;
  const upperBase = plinth + ground;
  const roofBase = upperBase + upper;
  const halfDepth = depth / 2;
  const jetty = size * 0.12;

  return [
    box(width * 1.05, plinth, depth * 1.05, 'rubble', null, [0, plinth / 2, 0]),
    box(width, ground, depth, 'plaster', '#ded0b2', [0, plinth + ground / 2, 0]),
    box(width + jetty, upper, depth + jetty, 'plaster', '#e8dcc0', [0, upperBase + upper / 2, 0]),
    box(width + jetty * 1.05, size * 0.12, depth + jetty * 1.05, 'timber', '#513520', [0, upperBase, 0]),
    ...uprights(
      [[-width / 2, -halfDepth], [width / 2, -halfDepth], [-width / 2, halfDepth], [width / 2, halfDepth]],
      size * 0.13,
      ground,
      'timber',
      '#4a3220',
      plinth,
    ),
    ...gableRoof({
      width: width + jetty,
      depth: depth + jetty,
      height: size * 0.72,
      surface: 'shingle',
      tint: null,
      base: roofBase,
      thickness: size * 0.14,
      overhang: size * 0.13,
    }),
    box(size * 0.4, size * 0.58, size * 0.07, 'plank', '#5c3c22', [0, plinth + size * 0.29, halfDepth]),
    box(size * 0.3, size * 0.28, size * 0.06, 'window', null, [-size * 0.78, plinth + ground * 0.62, halfDepth]),
    box(size * 0.3, size * 0.28, size * 0.06, 'window', null, [size * 0.78, plinth + ground * 0.62, halfDepth]),
    box(size * 0.3, size * 0.28, size * 0.06, 'window', null, [-size * 0.6, upperBase + upper * 0.5, halfDepth + jetty / 2]),
    box(size * 0.3, size * 0.28, size * 0.06, 'window', null, [size * 0.6, upperBase + upper * 0.5, halfDepth + jetty / 2]),
    box(size * 0.11, size * 0.72, size * 0.11, 'timber', '#3f2b1b', [width / 2 + size * 0.16, plinth + size * 0.36, halfDepth * 0.6]),
    box(size * 0.46, size * 0.3, size * 0.05, 'plank', '#8a5a30', [width / 2 + size * 0.16, plinth + size * 0.62, halfDepth * 0.6]),
    box(size * 0.26, size * 1.3, size * 0.26, 'rubble', '#8d8377', [-width * 0.36, size * 0.9, -halfDepth * 0.5]),
  ];
}

function tower(size) {
  const radius = size * 0.66;
  const body = size * 2.1;
  const plinth = size * 0.18;
  const bodyTop = plinth + body;

  return [
    cylinder(radius * 1.16, radius * 1.24, plinth, 14, 'rubble', null, [0, plinth / 2, 0]),
    cylinder(radius * 0.9, radius, body, 14, 'stoneBlock', '#9fa0a6', [0, plinth + body / 2, 0]),
    cylinder(radius * 1.12, radius * 1.12, size * 0.12, 14, 'stoneBlock', '#8d8f95', [0, bodyTop - size * 0.42, 0]),
    cone(radius * 1.22, size * 1.05, 12, 'roofTile', '#6a49a8', [0, bodyTop + size * 0.52, 0]),
    box(size * 0.3, size * 0.54, size * 0.08, 'plank', '#4d3428', [0, plinth + size * 0.27, radius * 0.98]),
    box(size * 0.22, size * 0.26, size * 0.08, 'window', '#9db8ff', [0, plinth + body * 0.42, radius * 0.94]),
    box(size * 0.22, size * 0.26, size * 0.08, 'window', '#9db8ff', [radius * 0.9, plinth + body * 0.72, 0], [0, Math.PI / 2, 0]),
    blob(size * 0.19, 'window', '#b58bff', [0, bodyTop + size * 1.2, 0], [1, 1.5, 1]),
  ];
}

function keep(size) {
  const half = size * 1.35;
  const plinth = size * 0.2;
  const body = size * 1.5;
  const bodyTop = plinth + body;
  const parapet = size * 0.24;
  const towerHeight = size * 1.95;
  const towerTop = plinth + towerHeight;

  const parts = [
    box(size * 2.9, plinth, size * 2.9, 'rubble', null, [0, plinth / 2, 0]),
    box(size * 2.7, body, size * 2.7, 'stoneBlock', '#9b9c98', [0, plinth + body / 2, 0]),
    box(size * 2.82, parapet, size * 2.82, 'stoneBlock', '#8b8d89', [0, bodyTop + parapet / 2, 0]),
    box(size * 0.56, size * 0.86, size * 0.14, 'timber', '#4a3a29', [0, plinth + size * 0.43, size * 1.36]),
    box(size * 0.16, size * 0.34, size * 0.1, 'window', '#8fa8c4', [-size * 0.7, plinth + body * 0.66, size * 1.36]),
    box(size * 0.16, size * 0.34, size * 0.1, 'window', '#8fa8c4', [size * 0.7, plinth + body * 0.66, size * 1.36]),
  ];

  for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    parts.push(cylinder(size * 0.5, size * 0.56, towerHeight, 12, 'stoneBlock', '#a4a5a1', [x, plinth + towerHeight / 2, z]));
    parts.push(cylinder(size * 0.58, size * 0.58, size * 0.14, 12, 'stoneBlock', '#878985', [x, towerTop + size * 0.07, z]));
    parts.push(cone(size * 0.6, size * 0.72, 10, 'roofTile', '#5c6a76', [x, towerTop + size * 0.5, z]));
  }
  return parts;
}

function wall(size) {
  const width = size * 0.9;
  const height = size * 0.74;
  const depth = size * 0.32;

  return [
    box(width * 1.08, size * 0.12, depth * 1.25, 'rubble', null, [0, size * 0.06, 0]),
    box(width, height, depth, 'stoneBlock', '#9b9c98', [0, size * 0.12 + height / 2, 0]),
    box(size * 0.2, size * 0.2, depth * 1.12, 'stoneBlock', '#8b8d89', [-size * 0.33, size * 0.96, 0]),
    box(size * 0.2, size * 0.2, depth * 1.12, 'stoneBlock', '#8b8d89', [size * 0.33, size * 0.96, 0]),
  ];
}

function tree(size) {
  const trunk = size * 0.78;

  return [
    cone(size * 0.24, size * 0.26, 8, 'bark', '#4e3722', [0, size * 0.13, 0]),
    cylinder(size * 0.1, size * 0.15, trunk, 8, 'bark', null, [0, trunk / 2, 0]),
    cone(size * 0.48, size * 0.86, 10, 'needles', '#2c6238', [0, size * 0.98, 0]),
    cone(size * 0.38, size * 0.76, 10, 'needles', '#357044', [0, size * 1.42, 0]),
    cone(size * 0.26, size * 0.62, 10, 'needles', '#3f8150', [0, size * 1.84, 0]),
  ];
}

function rock(size) {
  return [
    stone(size * 0.4, 'granite', null, [0, size * 0.3, 0], [0.18, 0.4, -0.12], [1.15, 0.86, 1]),
    stone(size * 0.2, 'granite', '#7d7a72', [size * 0.34, size * 0.14, -size * 0.24], [0.6, 1.1, 0.3], [1, 0.8, 1.1]),
    stone(size * 0.15, 'granite', '#93908a', [-size * 0.3, size * 0.1, size * 0.28], [-0.4, 0.2, 0.5]),
  ];
}

function oakTree(size) {
  const trunk = size * 1.15;

  return [
    cone(size * 0.34, size * 0.34, 9, 'bark', '#5a4029', [0, size * 0.17, 0]),
    cylinder(size * 0.16, size * 0.24, trunk, 9, 'bark', null, [0, trunk / 2, 0]),
    cylinder(size * 0.08, size * 0.11, size * 0.7, 7, 'bark', null, [size * 0.26, trunk * 0.86, 0], [0, 0, -0.72]),
    cylinder(size * 0.08, size * 0.11, size * 0.62, 7, 'bark', null, [-size * 0.22, trunk * 0.9, size * 0.1], [0.2, 0, 0.7]),
    blob(size * 0.62, 'foliage', '#4b8a34', [0, trunk + size * 0.44, 0], [1.2, 0.92, 1.2]),
    blob(size * 0.44, 'foliage', '#3d7a2c', [size * 0.5, trunk + size * 0.2, size * 0.16], [1.05, 0.85, 1.05]),
    blob(size * 0.4, 'foliage', '#569a3c', [-size * 0.46, trunk + size * 0.3, -size * 0.2], [1.05, 0.9, 1.05]),
    blob(size * 0.36, 'foliage', '#457f30', [size * 0.08, trunk + size * 0.82, -size * 0.32], [1, 0.9, 1]),
  ];
}

function bush(size) {
  return [
    cylinder(size * 0.05, size * 0.07, size * 0.2, 6, 'bark', null, [0, size * 0.1, 0]),
    blob(size * 0.3, 'foliage', '#487f31', [0, size * 0.32, 0], [1.2, 0.9, 1.2]),
    blob(size * 0.2, 'foliage', '#56943a', [size * 0.2, size * 0.24, size * 0.12], [1.1, 0.9, 1.1]),
    blob(size * 0.18, 'foliage', '#3d7029', [-size * 0.18, size * 0.22, -size * 0.14], [1.1, 0.9, 1.1]),
  ];
}

function cropField(size) {
  const rows = [-0.72, -0.36, 0, 0.36, 0.72].map((offset) => box(
    size * 1.7,
    size * 0.24,
    size * 0.22,
    'crop',
    null,
    [0, size * 0.16, size * offset],
  ));

  return [
    box(size * 1.92, size * 0.08, size * 1.92, 'soil', null, [0, size * 0.04, 0]),
    ...rows,
    box(size * 0.08, size * 0.36, size * 0.08, 'timber', '#6a4a2c', [-size * 0.88, size * 0.18, -size * 0.88]),
    box(size * 0.08, size * 0.36, size * 0.08, 'timber', '#6a4a2c', [size * 0.88, size * 0.18, size * 0.88]),
  ];
}

function well(size) {
  const radius = size * 0.34;
  const ring = size * 0.42;

  return [
    cylinder(radius * 1.2, radius * 1.3, size * 0.1, 12, 'rubble', null, [0, size * 0.05, 0]),
    cylinder(radius, radius * 1.06, ring, 12, 'rubble', '#9a978d', [0, size * 0.1 + ring / 2, 0]),
    cylinder(radius * 0.82, radius * 0.82, size * 0.04, 12, 'water', null, [0, size * 0.1 + ring * 0.78, 0]),
    box(size * 0.08, size * 0.62, size * 0.08, 'timber', '#5e4026', [-radius * 0.86, size * 0.83, 0]),
    box(size * 0.08, size * 0.62, size * 0.08, 'timber', '#5e4026', [radius * 0.86, size * 0.83, 0]),
    ...gableRoof({
      width: size * 0.84,
      depth: size * 0.68,
      height: size * 0.24,
      surface: 'shingle',
      tint: null,
      base: size * 1.14,
      thickness: size * 0.07,
      overhang: size * 0.05,
    }),
    cylinder(size * 0.1, size * 0.1, size * 0.16, 8, 'plank', '#7a5630', [0, size * 0.98, 0]),
  ];
}

function marketStall(size) {
  const width = size * 1.5;
  const depth = size * 1.05;
  const postHeight = size * 1.0;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  return [
    ...uprights(
      [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [-halfWidth, halfDepth], [halfWidth, halfDepth]],
      size * 0.1,
      postHeight,
      'timber',
      '#5e4026',
      0,
    ),
    box(width * 1.05, size * 0.1, depth * 0.62, 'plank', '#a07a46', [0, size * 0.56, halfDepth * 0.45]),
    box(width * 1.02, size * 0.36, size * 0.09, 'plank', '#8a6738', [0, size * 0.34, halfDepth * 0.98]),
    ...gableRoof({
      width,
      depth,
      height: size * 0.3,
      surface: 'fabric',
      tint: null,
      base: postHeight,
      thickness: size * 0.06,
      overhang: size * 0.2,
    }),
    box(size * 0.3, size * 0.3, size * 0.3, 'plank', '#8f6a3c', [-halfWidth * 0.55, size * 0.15, -halfDepth * 0.5]),
    box(size * 0.26, size * 0.26, size * 0.26, 'plank', '#7d5c34', [halfWidth * 0.6, size * 0.13, -halfDepth * 0.45]),
    blob(size * 0.14, 'crop', null, [0, size * 0.66, halfDepth * 0.45], [1.4, 0.7, 1]),
  ];
}

function chapel(size) {
  const width = size * 1.35;
  const depth = size * 2.3;
  const plinth = size * 0.18;
  const wallHeight = size * 1.1;
  const wallTop = plinth + wallHeight;
  const towerHeight = size * 1.9;

  return [
    box(width * 1.1, plinth, depth * 1.05, 'rubble', null, [0, plinth / 2, 0]),
    box(width, wallHeight, depth, 'stoneBlock', '#b0aea4', [0, plinth + wallHeight / 2, 0]),
    ...gableRoof({
      width,
      depth,
      height: size * 0.6,
      surface: 'roofTile',
      tint: null,
      base: wallTop,
      thickness: size * 0.12,
      overhang: size * 0.14,
      yaw: Math.PI / 2,
    }),
    box(size * 0.72, towerHeight, size * 0.72, 'stoneBlock', '#a5a399', [0, plinth + towerHeight / 2, -depth * 0.36]),
    cone(size * 0.56, size * 0.78, 4, 'roofTile', '#4d5f6e', [0, plinth + towerHeight + size * 0.39, -depth * 0.36], [0, Math.PI / 4, 0]),
    box(size * 0.36, size * 0.6, size * 0.08, 'timber', '#4f3520', [0, plinth + size * 0.3, depth / 2]),
    box(size * 0.24, size * 0.44, size * 0.07, 'window', '#c9a8ff', [0, plinth + wallHeight * 0.68, depth / 2]),
    box(size * 0.2, size * 0.42, size * 0.07, 'window', '#c9a8ff', [width / 2, plinth + wallHeight * 0.6, depth * 0.16], [0, Math.PI / 2, 0]),
    box(size * 0.2, size * 0.42, size * 0.07, 'window', '#c9a8ff', [-width / 2, plinth + wallHeight * 0.6, depth * 0.16], [0, Math.PI / 2, 0]),
    box(size * 0.08, size * 0.4, size * 0.08, 'bronze', null, [0, plinth + towerHeight + size * 0.98, -depth * 0.36]),
    box(size * 0.26, size * 0.08, size * 0.08, 'bronze', null, [0, plinth + towerHeight + size * 1.02, -depth * 0.36]),
  ];
}

function windmill(size) {
  const radius = size * 0.72;
  const body = size * 2.0;
  const plinth = size * 0.18;
  const bodyTop = plinth + body;
  const hubZ = radius * 0.92;
  const sailLength = size * 1.25;

  const sails = [0, 1, 2, 3].map((index) => {
    const angle = (index * Math.PI) / 2 + Math.PI / 4;
    return box(
      size * 0.18,
      sailLength,
      size * 0.05,
      'plank',
      '#b9986a',
      [
        Math.cos(angle + Math.PI / 2) * (sailLength / 2),
        bodyTop + size * 0.12 + Math.sin(angle + Math.PI / 2) * (sailLength / 2),
        hubZ + size * 0.12,
      ],
      [0, 0, angle],
    );
  });

  return [
    cylinder(radius * 1.16, radius * 1.28, plinth, 14, 'rubble', null, [0, plinth / 2, 0]),
    cylinder(radius * 0.78, radius, body, 14, 'stoneBlock', '#aca79b', [0, plinth + body / 2, 0]),
    cone(radius * 0.98, size * 0.6, 14, 'shingle', '#6a5a48', [0, bodyTop + size * 0.3, 0]),
    cylinder(size * 0.1, size * 0.1, size * 0.36, 8, 'timber', '#4f3520', [0, bodyTop + size * 0.12, hubZ], [Math.PI / 2, 0, 0]),
    ...sails,
    box(size * 0.34, size * 0.58, size * 0.08, 'plank', '#5c3f24', [0, plinth + size * 0.29, radius * 0.96]),
    box(size * 0.22, size * 0.26, size * 0.08, 'window', null, [radius * 0.84, plinth + body * 0.6, 0], [0, Math.PI / 2, 0]),
  ];
}

function watchtower(size) {
  const spread = size * 0.5;
  const legHeight = size * 1.5;
  const platform = legHeight;

  return [
    ...uprights(
      [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]],
      size * 0.13,
      legHeight,
      'timber',
      '#5a3d24',
      0,
    ),
    box(size * 1.3, size * 0.1, size * 1.3, 'plank', '#9b7746', [0, platform + size * 0.05, 0]),
    box(size * 1.3, size * 0.3, size * 0.08, 'plank', '#8a6a3e', [0, platform + size * 0.25, -size * 0.61]),
    box(size * 0.08, size * 0.3, size * 1.3, 'plank', '#8a6a3e', [-size * 0.61, platform + size * 0.25, 0]),
    box(size * 0.08, size * 0.3, size * 1.3, 'plank', '#8a6a3e', [size * 0.61, platform + size * 0.25, 0]),
    ...uprights(
      [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]],
      size * 0.09,
      size * 0.62,
      'timber',
      '#4f3520',
      platform + size * 0.1,
    ),
    cone(size * 0.98, size * 0.5, 4, 'shingle', null, [0, platform + size * 0.97, 0], [0, Math.PI / 4, 0]),
    box(size * 0.06, legHeight * 1.02, size * 0.06, 'timber', '#6a4a2c', [-size * 0.12, legHeight / 2, spread * 1.32], [0.16, 0, 0]),
    box(size * 0.06, legHeight * 1.02, size * 0.06, 'timber', '#6a4a2c', [size * 0.12, legHeight / 2, spread * 1.32], [0.16, 0, 0]),
    box(size * 0.34, size * 0.05, size * 0.05, 'timber', '#7a5734', [0, legHeight * 0.34, spread * 1.24]),
    box(size * 0.34, size * 0.05, size * 0.05, 'timber', '#7a5734', [0, legHeight * 0.66, spread * 1.3]),
  ];
}

function blacksmith(size) {
  const width = size * 1.5;
  const depth = size * 1.3;
  const plinth = size * 0.14;
  const wallHeight = size * 0.86;
  const wallTop = plinth + wallHeight;

  return [
    box(width * 1.06, plinth, depth * 1.06, 'rubble', null, [0, plinth / 2, 0]),
    box(width, wallHeight, depth, 'stoneBlock', '#9a968c', [0, plinth + wallHeight / 2, 0]),
    ...gableRoof({
      width,
      depth,
      height: size * 0.42,
      surface: 'shingle',
      tint: '#6b5b48',
      base: wallTop,
      thickness: size * 0.12,
      overhang: size * 0.16,
    }),
    box(size * 0.26, size * 1.3, size * 0.26, 'rubble', '#8a8175', [-width * 0.34, size * 0.72, -depth * 0.28]),
    box(size * 0.56, size * 0.5, size * 0.1, 'ember', null, [size * 0.24, plinth + size * 0.28, depth / 2]),
    box(size * 0.66, size * 0.14, size * 0.3, 'iron', null, [size * 0.24, plinth + size * 0.6, depth / 2 + size * 0.04]),
    cylinder(size * 0.14, size * 0.18, size * 0.34, 8, 'timber', '#4f3520', [-size * 0.5, size * 0.17, depth * 0.62]),
    box(size * 0.34, size * 0.2, size * 0.24, 'iron', '#5c6167', [-size * 0.5, size * 0.44, depth * 0.62]),
    box(size * 0.44, size * 0.24, size * 0.34, 'water', null, [size * 0.62, size * 0.12, -depth * 0.5]),
  ];
}

function fountain(size) {
  const radius = size * 0.82;

  return [
    cylinder(radius * 1.12, radius * 1.2, size * 0.14, 16, 'rubble', null, [0, size * 0.07, 0]),
    cylinder(radius, radius * 1.06, size * 0.38, 16, 'rubble', '#a29e94', [0, size * 0.33, 0]),
    cylinder(radius * 0.86, radius * 0.86, size * 0.06, 16, 'water', null, [0, size * 0.46, 0]),
    cylinder(size * 0.16, size * 0.22, size * 0.66, 10, 'bronze', null, [0, size * 0.79, 0]),
    cylinder(size * 0.34, size * 0.3, size * 0.08, 12, 'bronze', '#b8873a', [0, size * 1.16, 0]),
    blob(size * 0.16, 'water', null, [0, size * 1.3, 0], [1, 1.2, 1]),
  ];
}

function statue(size) {
  return [
    box(size * 0.66, size * 0.16, size * 0.66, 'stoneBlock', '#a8a69c', [0, size * 0.08, 0]),
    box(size * 0.5, size * 0.44, size * 0.5, 'stoneBlock', '#b2b0a6', [0, size * 0.38, 0]),
    cylinder(size * 0.15, size * 0.19, size * 0.62, 10, 'bronze', null, [0, size * 0.91, 0]),
    blob(size * 0.13, 'bronze', null, [0, size * 1.3, 0], [1, 1.1, 1]),
    cylinder(size * 0.05, size * 0.05, size * 0.42, 6, 'bronze', null, [size * 0.19, size * 1.06, 0], [0, 0, -0.85]),
    cylinder(size * 0.05, size * 0.05, size * 0.36, 6, 'bronze', null, [-size * 0.18, size * 0.98, 0], [0, 0, 0.4]),
  ];
}

function lampPost(size) {
  return [
    cylinder(size * 0.14, size * 0.18, size * 0.14, 8, 'stoneBlock', null, [0, size * 0.07, 0]),
    cylinder(size * 0.06, size * 0.08, size * 1.32, 8, 'iron', null, [0, size * 0.8, 0]),
    box(size * 0.3, size * 0.05, size * 0.05, 'iron', null, [size * 0.12, size * 1.44, 0]),
    box(size * 0.22, size * 0.28, size * 0.22, 'window', '#ffd08a', [size * 0.24, size * 1.3, 0]),
    cone(size * 0.16, size * 0.14, 4, 'iron', null, [size * 0.24, size * 1.51, 0], [0, Math.PI / 4, 0]),
  ];
}

function campfire(size) {
  const stones = [0, 1, 2, 3, 4].map((index) => {
    const angle = (index / 5) * Math.PI * 2;
    return stone(
      size * 0.12,
      'granite',
      '#84817a',
      [Math.cos(angle) * size * 0.34, size * 0.07, Math.sin(angle) * size * 0.34],
      [angle, angle * 1.7, 0],
      [1, 0.75, 1],
    );
  });

  return [
    cylinder(size * 0.38, size * 0.4, size * 0.05, 10, 'soil', null, [0, size * 0.025, 0]),
    ...stones,
    cylinder(size * 0.06, size * 0.07, size * 0.56, 6, 'timber', '#5b3f26', [0, size * 0.16, 0], [0.5, 0.4, 0]),
    cylinder(size * 0.06, size * 0.07, size * 0.56, 6, 'timber', '#4e3620', [0, size * 0.16, 0], [-0.5, -0.5, 0.2]),
    cone(size * 0.17, size * 0.42, 7, 'ember', null, [0, size * 0.34, 0]),
  ];
}

function fence(size) {
  return [
    box(size * 0.1, size * 0.62, size * 0.1, 'timber', '#5e4026', [-size * 0.42, size * 0.31, 0]),
    box(size * 0.1, size * 0.62, size * 0.1, 'timber', '#5e4026', [size * 0.42, size * 0.31, 0]),
    box(size * 0.94, size * 0.09, size * 0.05, 'plank', '#9a7648', [0, size * 0.46, 0]),
    box(size * 0.94, size * 0.09, size * 0.05, 'plank', '#9a7648', [0, size * 0.24, 0]),
  ];
}

const FACTORIES = Object.freeze({
  cottage,
  farmstead,
  inn,
  tower,
  keep,
  wall,
  tree,
  rock,
  oakTree,
  bush,
  cropField,
  well,
  marketStall,
  chapel,
  windmill,
  watchtower,
  blacksmith,
  fountain,
  statue,
  lampPost,
  campfire,
  fence,
});

export const OBJECT_MODEL_NAMES = Object.freeze(Object.keys(FACTORIES));

export function createObjectModelParts(definition, tileSize) {
  const factory = FACTORIES[definition.model];
  if (!factory) {
    throw new Error(`Unknown procedural object model: ${definition.model}.`);
  }
  return factory(tileSize);
}
