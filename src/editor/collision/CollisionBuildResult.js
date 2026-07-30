export const COLLISION_BUILD_DEFERRED = Object.freeze({
  status: 'deferred',
});

export function isCollisionBuildDeferred(result) {
  return result === COLLISION_BUILD_DEFERRED;
}
