import {
  OBJECT_COLLISION_POLICY_NONE,
  OBJECT_COLLISION_POLICY_SOLID,
  OBJECT_COLLISION_POLICY_TRIGGER,
  OBJECT_COLLISION_POLICY_WALKABLE,
} from './ObjectCollisionPolicy.js';

const BOX = 'box';
const CAPSULE = 'capsule';
const SPHERE = 'sphere';
const FOOTPRINT_EPSILON = 1e-6;

function freezeDescription(description) {
  return Object.freeze({
    ...description,
    position: Object.freeze([...description.position]),
    dimensions: Object.freeze([...description.dimensions]),
  });
}

function box(partId, width, height, depth, x, y, z, rotationY = 0) {
  return freezeDescription({
    partId,
    type: BOX,
    position: [x, y, z],
    dimensions: [width, height, depth],
    rotationY,
  });
}

function capsule(partId, radius, height, x, baseY, z) {
  return freezeDescription({
    partId,
    type: CAPSULE,
    position: [x, baseY, z],
    dimensions: [radius, height, radius],
    rotationY: 0,
  });
}

function sphere(partId, radiusX, radiusY, radiusZ, x, y, z, rotationY = 0) {
  return freezeDescription({
    partId,
    type: SPHERE,
    position: [x, y, z],
    dimensions: [radiusX, radiusY, radiusZ],
    rotationY,
  });
}

function doorwayShell({
  width,
  depth,
  height,
  doorWidth,
  doorHeight,
  thickness,
  centerX = 0,
  centerZ = 0,
}) {
  const sideWidth = Math.max(thickness, (width - doorWidth) / 2);
  const frontZ = centerZ + depth / 2 - thickness / 2;
  const backZ = centerZ - depth / 2 + thickness / 2;
  const sideOffset = doorWidth / 2 + sideWidth / 2;
  const lintelHeight = Math.max(thickness, height - doorHeight);
  return [
    box('wall-left', thickness, height, depth, centerX - width / 2 + thickness / 2, height / 2, centerZ),
    box('wall-right', thickness, height, depth, centerX + width / 2 - thickness / 2, height / 2, centerZ),
    box('wall-back', width - thickness * 2, height, thickness, centerX, height / 2, backZ),
    box('wall-front-left', sideWidth, height, thickness, centerX - sideOffset, height / 2, frontZ),
    box('wall-front-right', sideWidth, height, thickness, centerX + sideOffset, height / 2, frontZ),
    box(
      'wall-front-lintel',
      doorWidth,
      lintelHeight,
      thickness,
      centerX,
      doorHeight + lintelHeight / 2,
      frontZ,
    ),
  ];
}

function postRectangle({ spreadX, spreadZ, width, height, baseY = 0, prefix = 'post' }) {
  return [
    [-spreadX, -spreadZ],
    [spreadX, -spreadZ],
    [-spreadX, spreadZ],
    [spreadX, spreadZ],
  ].map(([x, z], index) => box(
    `${prefix}-${index}`,
    width,
    height,
    width,
    x,
    baseY + height / 2,
    z,
  ));
}

function cottage(size) {
  return doorwayShell({
    width: size * 1.55,
    depth: size * 1.4,
    height: size * 0.92,
    doorWidth: size * 0.52,
    doorHeight: size * 0.7,
    thickness: size * 0.14,
  });
}

function farmstead(size) {
  return doorwayShell({
    width: size * 1.2,
    depth: size * 1.12,
    height: size * 0.88,
    doorWidth: size * 0.5,
    doorHeight: size * 0.66,
    thickness: size * 0.13,
    centerX: -size * 0.6,
    centerZ: -size * 0.55,
  });
}

function inn(size) {
  return doorwayShell({
    width: size * 2.35,
    depth: size * 1.45,
    height: size * 1.64,
    doorWidth: size * 0.62,
    doorHeight: size * 0.82,
    thickness: size * 0.15,
  });
}

function marketStall(size) {
  return [
    ...postRectangle({
      spreadX: size * 0.62,
      spreadZ: size * 0.48,
      width: size * 0.11,
      height: size * 1.2,
    }),
    box('counter', size * 1.15, size * 0.38, size * 0.28, 0, size * 0.55, -size * 0.42),
  ];
}

function blacksmith(size) {
  return doorwayShell({
    width: size * 1.5,
    depth: size * 1.3,
    height: size,
    doorWidth: size * 0.66,
    doorHeight: size * 0.78,
    thickness: size * 0.15,
  });
}

function chapel(size) {
  return doorwayShell({
    width: size * 1.65,
    depth: size * 2.25,
    height: size * 1.45,
    doorWidth: size * 0.62,
    doorHeight: size * 0.92,
    thickness: size * 0.16,
  });
}

function windmill(size) {
  return doorwayShell({
    width: size * 1.35,
    depth: size * 1.35,
    height: size * 1.8,
    doorWidth: size * 0.5,
    doorHeight: size * 0.78,
    thickness: size * 0.16,
  });
}

function tower(size) {
  return doorwayShell({
    width: size * 1.32,
    depth: size * 1.32,
    height: size * 2.28,
    doorWidth: size * 0.48,
    doorHeight: size * 0.82,
    thickness: size * 0.2,
  });
}

function keep(size) {
  return doorwayShell({
    width: size * 3.1,
    depth: size * 3.1,
    height: size * 2.15,
    doorWidth: size * 0.9,
    doorHeight: size * 1.1,
    thickness: size * 0.28,
  });
}

function watchtower(size) {
  return [
    ...postRectangle({
      spreadX: size * 0.5,
      spreadZ: size * 0.5,
      width: size * 0.14,
      height: size * 1.5,
    }),
    box('platform-back', size * 1.3, size * 0.32, size * 0.1, 0, size * 1.72, -size * 0.6),
    box('platform-left', size * 0.1, size * 0.32, size * 1.2, -size * 0.6, size * 1.72, 0),
    box('platform-right', size * 0.1, size * 0.32, size * 1.2, size * 0.6, size * 1.72, 0),
  ];
}

function wall(size) {
  return [box('wall', size * 0.96, size * 1.15, size * 0.28, 0, size * 0.575, 0)];
}

function fence(size) {
  return [
    box('post-left', size * 0.12, size * 0.64, size * 0.12, -size * 0.42, size * 0.32, 0),
    box('post-right', size * 0.12, size * 0.64, size * 0.12, size * 0.42, size * 0.32, 0),
    box('rail-upper', size * 0.9, size * 0.11, size * 0.08, 0, size * 0.46, 0),
    box('rail-lower', size * 0.9, size * 0.11, size * 0.08, 0, size * 0.24, 0),
  ];
}

function well(size) {
  const width = size * 0.28;
  const offset = size * 0.31;
  return [
    box('ring-front', size * 0.9, size * 0.48, width, 0, size * 0.24, offset),
    box('ring-back', size * 0.9, size * 0.48, width, 0, size * 0.24, -offset),
    box('ring-left', width, size * 0.48, size * 0.62, -offset, size * 0.24, 0),
    box('ring-right', width, size * 0.48, size * 0.62, offset, size * 0.24, 0),
  ];
}

function fountain(size) {
  return [
    sphere('basin', size * 0.92, size * 0.34, size * 0.92, 0, size * 0.32, 0),
    capsule('column', size * 0.2, size * 1.15, 0, size * 0.2, 0),
  ];
}

function statue(size) {
  return [
    box('plinth', size * 0.66, size * 0.6, size * 0.66, 0, size * 0.3, 0),
    capsule('statue', size * 0.18, size * 0.92, 0, size * 0.6, 0),
  ];
}

function lampPost(size) {
  return [capsule('post', size * 0.12, size * 1.55, 0, 0, 0)];
}

function tree(size) {
  return [capsule('trunk', size * 0.18, size * 1.8, 0, 0, 0)];
}

function oakTree(size) {
  return [capsule('trunk', size * 0.24, size * 1.65, 0, 0, 0)];
}

function rock(size) {
  return [sphere('rock', size * 0.44, size * 0.34, size * 0.4, 0, size * 0.3, 0)];
}

const FACTORIES = Object.freeze({
  cottage,
  farmstead,
  inn,
  marketStall,
  blacksmith,
  chapel,
  windmill,
  tower,
  keep,
  watchtower,
  wall,
  fence,
  well,
  fountain,
  statue,
  lampPost,
  tree,
  oakTree,
  rock,
});

function descriptionBounds(description) {
  if (description.type === BOX) {
    const halfX = description.dimensions[0] / 2;
    const halfZ = description.dimensions[2] / 2;
    const cosine = Math.abs(Math.cos(description.rotationY));
    const sine = Math.abs(Math.sin(description.rotationY));
    const extentX = cosine * halfX + sine * halfZ;
    const extentZ = sine * halfX + cosine * halfZ;
    return {
      minX: description.position[0] - extentX,
      maxX: description.position[0] + extentX,
      minZ: description.position[2] - extentZ,
      maxZ: description.position[2] + extentZ,
    };
  }
  return {
    minX: description.position[0] - description.dimensions[0],
    maxX: description.position[0] + description.dimensions[0],
    minZ: description.position[2] - description.dimensions[2],
    maxZ: description.position[2] + description.dimensions[2],
  };
}

function validateFootprint(definition, tileSize, descriptions) {
  if (definition.collision.allowFootprintOverflow) return;
  const halfWidth = definition.footprint.width * tileSize / 2 + FOOTPRINT_EPSILON;
  const halfDepth = definition.footprint.depth * tileSize / 2 + FOOTPRINT_EPSILON;
  for (const description of descriptions) {
    const bounds = descriptionBounds(description);
    if (bounds.minX < -halfWidth || bounds.maxX > halfWidth
        || bounds.minZ < -halfDepth || bounds.maxZ > halfDepth) {
      throw new Error(
        `Object ${definition.key} collider ${description.partId} exceeds its reserved footprint.`,
      );
    }
  }
}

function applyOverrides(descriptions, collision) {
  const scale = collision.scale ?? { x: 1, y: 1, z: 1 };
  const offset = collision.offset ?? { x: 0, y: 0, z: 0 };
  return descriptions.map((description) => freezeDescription({
    ...description,
    position: [
      description.position[0] * scale.x + offset.x,
      description.position[1] * scale.y + offset.y,
      description.position[2] * scale.z + offset.z,
    ],
    dimensions: [
      description.dimensions[0] * scale.x,
      description.dimensions[1] * scale.y,
      description.dimensions[2] * scale.z,
    ],
  }));
}

export function objectCollisionLayers(policy) {
  if (policy === OBJECT_COLLISION_POLICY_TRIGGER) return 'trigger';
  if (policy === OBJECT_COLLISION_POLICY_WALKABLE) return 'solid';
  if (policy === OBJECT_COLLISION_POLICY_SOLID) return 'blocking';
  return null;
}

export function createObjectColliderDescriptions(definition, tileSize) {
  if (!definition?.collision || !Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error('Object collider creation requires a validated definition and tile size.');
  }
  if (definition.collision.policy === OBJECT_COLLISION_POLICY_NONE) return Object.freeze([]);
  const factory = FACTORIES[definition.collision.profile ?? definition.model];
  if (!factory) {
    throw new Error(`Object ${definition.key} has no collider profile ${definition.collision.profile}.`);
  }
  const descriptions = applyOverrides(factory(tileSize), definition.collision);
  validateFootprint(definition, tileSize, descriptions);
  return Object.freeze(descriptions);
}
