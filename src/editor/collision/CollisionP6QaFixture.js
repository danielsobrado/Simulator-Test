const FIXTURE_DEFINITION = 'cottage';
const FIXTURE_CANDIDATES = Object.freeze([
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
]);

export function ensureCollisionP6QaFixture(objectMap, search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('qa') !== 'collision-p6') return null;

  const existing = objectMap.list().find(
    (object) => object.definitionKey === FIXTURE_DEFINITION,
  );
  if (existing) return existing;

  for (const [x, z] of FIXTURE_CANDIDATES) {
    const candidate = {
      definitionKey: FIXTURE_DEFINITION,
      x,
      z,
      rotation: 0,
    };
    if (!objectMap.validatePlacement(candidate).valid) continue;
    return objectMap.place(candidate);
  }
  throw new Error('Collision P6 QA could not place its deterministic cottage fixture.');
}
