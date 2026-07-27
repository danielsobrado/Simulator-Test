function isSpellPointLight(object) {
  return object.isPointLight === true && object.name.includes("spell");
}
function collectSpellPointLights(scene) {
  const lights = [];
  scene.traverse((object) => {
    if (isSpellPointLight(object)) lights.push(object);
  });
  return lights;
}
function suppressSpellPointLights(lights) {
  for (const light of lights) {
    light.intensity = 0;
    light.visible = false;
  }
}
function createStableSpellController(target, scene) {
  const spellLights = collectSpellPointLights(scene);
  const stabilize = () => suppressSpellPointLights(spellLights);
  stabilize();
  return {
    playFire: (durationMs) => {
      target.playFire(durationMs);
      stabilize();
    },
    playWater: (durationMs) => {
      target.playWater(durationMs);
      stabilize();
    },
    playAir: (durationMs) => {
      target.playAir(durationMs);
      stabilize();
    },
    playEarth: (durationMs) => {
      const fired = target.playEarth(durationMs);
      stabilize();
      return fired;
    },
    playLightning: (durationMs) => {
      target.playLightning(durationMs);
      stabilize();
    },
    playFireball: (durationMs) => {
      target.playFireball(durationMs);
      stabilize();
    },
    update: (nowMs) => {
      target.update(nowMs);
      stabilize();
    },
    precompile: (renderer) => {
      target.precompile(renderer);
      stabilize();
    },
    dispose: () => target.dispose()
  };
}
export {
  createStableSpellController
};
