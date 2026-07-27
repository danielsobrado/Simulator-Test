import * as THREE from "three";
const SPELL_NAME_PREFIXES = [
  "fire-spell",
  "water-spell",
  "air-spell",
  "earth-spell",
  "lightning-spell",
  "fireball-spell"
];
function hasSpellName(object) {
  return SPELL_NAME_PREFIXES.some((prefix) => object.name.startsWith(prefix));
}
function isRenderableSpellObject(object) {
  if (!hasSpellName(object) || object.isLight === true) return false;
  return object.isMesh === true || object.isLine === true || object.isPoints === true || object.isSprite === true;
}
function collectSpellRenderables(scene) {
  const renderables = [];
  scene.traverse((object) => {
    if (isRenderableSpellObject(object)) renderables.push(object);
  });
  return renderables;
}
function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
async function warmSpellPipelines(deps) {
  const renderer = deps.renderer;
  const compileAsync = renderer.compileAsync;
  if (typeof compileAsync !== "function") return;
  for (const object of collectSpellRenderables(deps.scene)) {
    const compileScene = new THREE.Scene();
    const proxy = object.clone(false);
    proxy.visible = true;
    compileScene.add(proxy);
    let compilePromise;
    try {
      compilePromise = compileAsync.call(renderer, compileScene, deps.camera);
    } catch {
      continue;
    }
    await compilePromise.catch(() => void 0);
    await yieldToBrowser();
  }
}
function scheduleSpellPipelineWarmup(deps) {
  void deps;
  return {
    ready: Promise.resolve(),
    dispose() {
    }
  };
}
export {
  scheduleSpellPipelineWarmup,
  warmSpellPipelines
};
