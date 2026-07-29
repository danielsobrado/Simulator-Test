const SPELL_PREWARM_NAME_PREFIXES = Object.freeze([
  'fire-spell',
  'water-spell',
  'air-spell',
  'earth-spell',
  'lightning-spell',
  'fireball-spell',
]);

function spellObjectNeedsPrewarm(object) {
  return object.visible === false
    && SPELL_PREWARM_NAME_PREFIXES.some((prefix) => object.name.startsWith(prefix));
}

export async function precompileSpellObjects(
  renderer,
  scene,
  camera,
  { warn = console.warn } = {},
) {
  const compile = renderer.compileAsync ?? renderer.compile;
  if (typeof compile !== 'function') return false;

  const toggled = [];
  for (const child of scene.children) {
    if (!spellObjectNeedsPrewarm(child)) continue;
    child.visible = true;
    toggled.push(child);
  }
  if (toggled.length === 0) return false;

  try {
    await compile.call(renderer, scene, camera);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`[spells] Shader precompile failed; first cast may hitch. ${reason}`);
    return false;
  } finally {
    for (const object of toggled) object.visible = false;
  }
}
