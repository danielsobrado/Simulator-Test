import * as THREE from 'three/webgpu';
import { normalizeWorkshopComposition } from './ProceduralWorkshopComposition.js';
import { createSkeletonRoofParts } from './ProceduralWorkshopSkeletonRoof.js';

function material(slot, color, options = {}) {
  const result = new THREE.MeshStandardNodeMaterial({
    color,
    roughness: options.roughness ?? 0.9,
    metalness: options.metalness ?? 0,
    vertexColors: options.vertexColors ?? false,
  });
  result.userData.workshopSlot = slot;
  return result;
}

function semanticGeometry(geometry, primitive, attachmentSurface = null) {
  geometry.userData.workshopSemantic = {
    id: primitive.id,
    label: primitive.kind === 'wall' ? `Wall ${primitive.id}` : `Volume ${primitive.id}`,
    kind: 'structure',
    attachmentSurface,
  };
  return geometry;
}

function matrixAt(x, y, z, rotation = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(rotation), 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

function part(geometry, materialValue, matrix, materialRegion) {
  return { geometry, material: materialValue, matrix, materialRegion };
}

function rectangleParts(primitive, materials) {
  const [width, depth] = primitive.dimensions;
  const thickness = Math.min(0.32, width * 0.08, depth * 0.08);
  const y = primitive.elevation + primitive.height / 2;
  const transform = matrixAt(
    primitive.position[0],
    y,
    primitive.position[1],
    primitive.rotation,
  );
  const wallSpecs = [
    ['north', width, thickness, 0, depth / 2 - thickness / 2],
    ['south', width, thickness, 0, -depth / 2 + thickness / 2],
    ['east', thickness, depth, width / 2 - thickness / 2, 0],
    ['west', thickness, depth, -width / 2 + thickness / 2, 0],
  ];
  const result = wallSpecs.map(([face, sizeX, sizeZ, x, z]) => {
    const geometry = semanticGeometry(
      new THREE.BoxGeometry(sizeX, primitive.height, sizeZ),
      primitive,
      { type: 'planar', width: sizeX, height: primitive.height, radius: 0 },
    );
    geometry.translate(x, 0, z);
    return part(geometry, materials.walls, transform.clone(), {
      id: `${primitive.id}:facade:${face}`,
      componentId: primitive.id,
      label: `${face[0].toUpperCase()}${face.slice(1)} façade`,
      family: 'walls',
      connected: true,
    });
  });
  return result;
}

function circleParts(primitive, materials) {
  const y = primitive.elevation + primitive.height / 2;
  const transform = matrixAt(
    primitive.position[0],
    y,
    primitive.position[1],
    primitive.rotation,
  );
  const shell = semanticGeometry(
    new THREE.CylinderGeometry(
      primitive.radius,
      primitive.radius,
      primitive.height,
      32,
      1,
      true,
    ),
    primitive,
    { type: 'round', radius: primitive.radius, height: primitive.height },
  );
  const result = [part(shell, materials.walls, transform.clone(), {
    id: `${primitive.id}:tower-shell`,
    componentId: primitive.id,
    label: 'Tower shell',
    family: 'walls',
    connected: true,
  })];
  const roofHeight = primitive.roofFamily === 'flat' ? 0.25 : Math.min(4, primitive.radius * 1.25);
  const roof = primitive.roofFamily === 'flat'
    ? new THREE.CylinderGeometry(primitive.radius + 0.2, primitive.radius + 0.2, roofHeight, 32)
    : new THREE.ConeGeometry(primitive.radius + 0.25, roofHeight, 32);
  roof.translate(0, primitive.height / 2 + roofHeight / 2, 0);
  result.push(part(roof, materials.roof, transform.clone(), {
    id: `${primitive.id}:roof:main`,
    componentId: primitive.id,
    label: 'Tower roof',
    family: 'roof',
    connected: true,
  }));
  return result;
}

function wallParts(primitive, materials) {
  const result = [];
  for (let index = 0; index < primitive.points.length - 1; index += 1) {
    const [startX, startZ] = primitive.points[index];
    const [endX, endZ] = primitive.points[index + 1];
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const angle = THREE.MathUtils.radToDeg(Math.atan2(dz, dx));
    const geometry = semanticGeometry(
      new THREE.BoxGeometry(length, primitive.height, primitive.thickness),
      primitive,
      { type: 'planar', width: length, height: primitive.height, radius: 0 },
    );
    result.push(part(
      geometry,
      materials.walls,
      matrixAt(
        (startX + endX) / 2,
        primitive.elevation + primitive.height / 2,
        (startZ + endZ) / 2,
        -angle,
      ),
      {
        id: `${primitive.id}:segment-${index + 1}:side-a`,
        componentId: primitive.id,
        label: `Wall segment ${index + 1}`,
        family: 'walls',
        connected: true,
      },
    ));
  }
  return result;
}

export function createWorkshopCompositionParts(recipe) {
  const composition = normalizeWorkshopComposition(recipe.composition);
  const materials = {
    walls: material('mortar', '#b69b70'),
    roof: material('roof', '#566864', { roughness: 0.82, vertexColors: true }),
  };
  const parts = composition.primitives.flatMap((primitive) => (
    primitive.kind === 'rectangle'
      ? rectangleParts(primitive, materials)
      : primitive.kind === 'circle'
        ? circleParts(primitive, materials)
        : wallParts(primitive, materials)
  ));
  const roofResult = createSkeletonRoofParts({
    recipe,
    rectangles: composition.primitives.filter(({ kind }) => kind === 'rectangle'),
    circles: composition.primitives.filter(({ kind }) => kind === 'circle'),
    roofMaterial: materials.roof,
    wallMaterial: materials.walls,
    roofPitch: recipe.roofPitch,
    roofOverhang: recipe.roofOverhang,
  });
  parts.push(...roofResult.parts);
  for (const materialValue of Object.values(materials)) {
    if (!parts.some((entry) => entry.material === materialValue)) materialValue.dispose();
  }
  const sourceVertices = parts.reduce((total, entry) => (
    total + (entry.geometry.getAttribute('position')?.count ?? 0)
  ), 0);
  Object.defineProperty(parts, 'stats', {
    enumerable: false,
    value: Object.freeze({
      stones: 0,
      features: composition.primitives.length,
      sourceVertices,
      primitives: composition.primitives.length,
      ...roofResult.stats,
    }),
  });
  return parts;
}
