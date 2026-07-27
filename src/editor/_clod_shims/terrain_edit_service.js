
export function createTerrainEditService() {
  return {
    prepare() { return null; },
    execute() { return { ok: false, reason: 'terrain-edit-unavailable' }; },
  };
}
export function prepareTerrainEdit() { return null; }
export function executeTerrainEdit() { return { ok: false }; }
