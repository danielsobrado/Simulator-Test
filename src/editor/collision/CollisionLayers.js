export const COLLISION_LAYER_BLOCKING = 1 << 0;
export const COLLISION_LAYER_WALKABLE = 1 << 1;
export const COLLISION_LAYER_TRIGGER = 1 << 2;

export const COLLISION_LAYERS = Object.freeze({
  blocking: COLLISION_LAYER_BLOCKING,
  walkable: COLLISION_LAYER_WALKABLE,
  trigger: COLLISION_LAYER_TRIGGER,
  solid: COLLISION_LAYER_BLOCKING | COLLISION_LAYER_WALKABLE,
  all: COLLISION_LAYER_BLOCKING | COLLISION_LAYER_WALKABLE | COLLISION_LAYER_TRIGGER,
});

export function collisionLayersMatch(colliderLayers, queryLayers) {
  return (colliderLayers & queryLayers) !== 0;
}
