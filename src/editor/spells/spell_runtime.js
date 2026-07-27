import * as THREE from 'three';
import { defaultSpellConfig } from './spell_config.js';
import { createSpellMenu } from './spell_menu.js';
import { createSpellVfxController } from './spell_vfx_controller.js';

function meshConfig(vfx) {
  return {
    worldWidth: vfx.worldWidth,
    worldHeight: vfx.worldHeight,
    flameScale: vfx.flameScale,
    handForwardM: vfx.handForwardM,
    handRightM: vfx.handRightM,
    handUpM: vfx.handUpM,
    glowColor: vfx.glowColor,
    glowIntensity: vfx.glowIntensity,
    glowDistance: vfx.glowDistance,
    glowDecay: vfx.glowDecay,
    glowLocalYRatio: vfx.glowLocalYRatio,
  };
}

/**
 * Walk-mode spell VFX. Earth digs are VFX-only here (no CLOD convergence).
 * The menu is visible only while the player is in walk mode.
 */
export function createSpellRuntime(deps) {
  const config = deps.config ?? defaultSpellConfig;
  const scene = deps.scene;
  const getCamera = () => deps.getCamera();
  const isWalkMode = () => deps.isWalkMode?.() === true;
  const targetRay = new THREE.Ray();
  const targetDirection = new THREE.Vector3();
  const targetNormal = new THREE.Vector3(0, 1, 0);

  const getTerrainTarget = (maxRange) => {
    const camera = getCamera();
    camera.getWorldDirection(targetDirection).normalize();
    targetRay.origin.copy(camera.position);
    targetRay.direction.copy(targetDirection);
    const hit = deps.raycastTerrain?.(targetRay, maxRange) ?? null;
    return hit
      ? { point: hit.point.clone(), normal: (hit.normal ?? targetNormal).clone() }
      : null;
  };

  const vfx = createSpellVfxController({
    scene,
    getCamera,
    fire: meshConfig(config.fire.vfx),
    water: meshConfig(config.water.vfx),
    air: meshConfig(config.air.vfx),
    earth: config.earth.vfx,
    lightning: config.lightning.vfx,
    fireball: config.fireball.vfx,
    getEarthTarget: () => getTerrainTarget(config.earth.vfx.impactRadius * 4 || 10),
    getLightningTarget: () => getTerrainTarget(config.lightning.vfx.maxRange),
    raycastFireballTerrain: (origin, direction, maxDistance) => {
      targetRay.origin.copy(origin);
      targetRay.direction.copy(direction).normalize();
      const hit = deps.raycastTerrain?.(targetRay, maxDistance) ?? null;
      return hit
        ? { point: hit.point.clone(), normal: (hit.normal ?? targetNormal).clone() }
        : null;
    },
  });

  const menu = createSpellMenu({
    config,
    root: deps.menuRoot,
    controller: {
      playFire: (ms) => vfx.playFire(ms ?? config.fire.castDurationMs),
      playWater: (ms) => vfx.playWater(ms ?? config.water.castDurationMs),
      playAir: (ms) => vfx.playAir(ms ?? config.air.castDurationMs),
      playEarth: (ms) => vfx.playEarth(ms ?? config.earth.castDurationMs),
      playLightning: (ms) => vfx.playLightning(ms ?? config.lightning.castDurationMs),
      playFireball: (ms) => vfx.playFireball(ms ?? config.fireball.castDurationMs),
    },
  });

  const menuEl = document.getElementById(config.menu.rootId);

  const syncMenuVisibility = () => {
    const visible = isWalkMode();
    menuEl?.classList.toggle('spell-menu-hidden', !visible);
    if (menuEl) {
      menuEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
      menuEl.toggleAttribute('inert', !visible);
    }
  };
  syncMenuVisibility();

  const unsubscribeMode = typeof deps.subscribeViewMode === 'function'
    ? deps.subscribeViewMode(() => syncMenuVisibility())
    : null;

  const castByDigit = (digit) => {
    if (digit === 1) menu.castFire();
    else if (digit === 2) menu.castWater();
    else if (digit === 3) menu.castAir();
    else if (digit === 4) menu.castEarth();
    else if (digit === 5) menu.castLightning();
    else if (digit === 6) menu.castFireball();
  };

  const onKeyDown = (event) => {
    if (!isWalkMode()) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const code = event.code;
    if (code === 'Digit1' || code === 'Numpad1') castByDigit(1);
    else if (code === 'Digit2' || code === 'Numpad2') castByDigit(2);
    else if (code === 'Digit3' || code === 'Numpad3') castByDigit(3);
    else if (code === 'Digit4' || code === 'Numpad4') castByDigit(4);
    else if (code === 'Digit5' || code === 'Numpad5') castByDigit(5);
    else if (code === 'Digit6' || code === 'Numpad6') castByDigit(6);
    else return;
    event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown, true);

  return {
    syncMenuVisibility,
    update(nowMs) {
      vfx.update(nowMs);
    },
    precompile(renderer) {
      vfx.precompile(renderer);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      unsubscribeMode?.();
      menu.dispose();
      vfx.dispose();
    },
  };
}
