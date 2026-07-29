import * as THREE from 'three';
import { earthSpellGameplayConfig } from './earth_spell_gameplay_config.js';
import { defaultSpellConfig } from './spell_config.js';
import { createSpellMenu } from './spell_menu.js';
import { createSpellVfxController } from './spell_vfx_controller.js';

const FIREBALL_COLLISION_PROBE_PADDING_M = 1.5;
const FIREBALL_COLLISION_PROBE_SECONDS = 0.075;
const SPELL_IDS = Object.freeze(['fire', 'water', 'air', 'earth', 'lightning', 'fireball']);

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

function consumesGameplayShortcut(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || tagName === 'button';
}

function fireballCollisionRange(config) {
  const probeSeconds = FIREBALL_COLLISION_PROBE_SECONDS;
  return Math.max(
    3,
    config.launchSpeed * probeSeconds
      + Math.abs(config.liftSpeed) * probeSeconds
      + 0.5 * Math.max(0, config.gravity) * probeSeconds * probeSeconds
      + config.projectileRadius * 2
      + FIREBALL_COLLISION_PROBE_PADDING_M,
  );
}

/**
 * Walk-mode spell runtime.
 *
 * Terrain interaction is supplied by the raycast hit capability, keeping the
 * spell system independent from the simulator world-store implementation.
 */
export function createSpellRuntime(deps) {
  const config = deps.config ?? defaultSpellConfig;
  const gameplay = deps.earthGameplayConfig ?? earthSpellGameplayConfig;
  const scene = deps.scene;
  const getCamera = () => deps.getCamera();
  const isWalkMode = () => deps.isWalkMode?.() === true;
  const targetRay = new THREE.Ray();
  const targetDirection = new THREE.Vector3();
  const targetNormal = new THREE.Vector3(0, 1, 0);
  let earthTargetOverride = null;
  let viewState = null;
  let disposed = false;

  const isCastMode = () => isWalkMode()
    && viewState?.paused !== true
    && viewState?.awaitingSpawn !== true;

  const getTerrainTarget = (maxRange) => {
    const camera = getCamera();
    camera.getWorldDirection(targetDirection).normalize();
    targetRay.origin.copy(camera.position);
    targetRay.direction.copy(targetDirection);
    const hit = deps.raycastTerrain?.(targetRay, maxRange) ?? null;
    if (!hit) return null;
    return {
      point: hit.point.clone(),
      normal: (hit.normal ?? targetNormal).clone(),
      commitEarthEdit: hit.commitEarthEdit,
    };
  };

  const getEarthVfxTarget = () => {
    const override = earthTargetOverride;
    earthTargetOverride = null;
    return override ?? getTerrainTarget(gameplay.maxRangeM);
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
    getEarthTarget: getEarthVfxTarget,
    getLightningTarget: () => getTerrainTarget(config.lightning.vfx.maxRange),
    raycastFireballTerrain: (ray) => (
      deps.raycastTerrain?.(ray, fireballCollisionRange(config.fireball.vfx)) ?? null
    ),
  });

  const casts = {
    fire: (durationMs = config.fire.castDurationMs) => vfx.playFire(durationMs) !== false,
    water: (durationMs = config.water.castDurationMs) => vfx.playWater(durationMs) !== false,
    air: (durationMs = config.air.castDurationMs) => vfx.playAir(durationMs) !== false,
    earth: (durationMs = config.earth.castDurationMs) => {
      const target = getTerrainTarget(gameplay.maxRangeM);
      if (!target) return false;
      if (gameplay.enabled) {
        const result = target.commitEarthEdit?.(gameplay);
        if (!result?.ok || !result.changed) return false;
      }
      earthTargetOverride = { point: target.point, normal: target.normal };
      return vfx.playEarth(durationMs) !== false;
    },
    lightning: (durationMs = config.lightning.castDurationMs) => (
      vfx.playLightning(durationMs) !== false
    ),
    fireball: (durationMs = config.fireball.castDurationMs) => (
      vfx.playFireball(durationMs) !== false
    ),
  };

  const cast = (spellId, durationMs) => {
    if (disposed || !isCastMode() || deps.isInputBlocked?.()) return false;
    const play = casts[spellId];
    return typeof play === 'function' ? play(durationMs) : false;
  };

  const menu = createSpellMenu({
    config,
    root: deps.menuRoot,
    controller: {
      playFire: (durationMs) => cast('fire', durationMs),
      playWater: (durationMs) => cast('water', durationMs),
      playAir: (durationMs) => cast('air', durationMs),
      playEarth: (durationMs) => cast('earth', durationMs),
      playLightning: (durationMs) => cast('lightning', durationMs),
      playFireball: (durationMs) => cast('fireball', durationMs),
    },
  });

  const menuEl = document.getElementById(config.menu.rootId);
  const syncMenuVisibility = () => {
    const visible = isCastMode();
    menuEl?.classList.toggle('spell-menu-hidden', !visible);
    if (menuEl) {
      menuEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
      menuEl.toggleAttribute('inert', !visible);
    }
  };

  const unsubscribeMode = typeof deps.subscribeViewMode === 'function'
    ? deps.subscribeViewMode((state) => {
      viewState = state;
      syncMenuVisibility();
    })
    : null;
  syncMenuVisibility();

  /**
   * @returns {boolean} true when the event was claimed as a spell cast
   */
  const handleKeyDown = (event) => {
    if (disposed || !isCastMode() || deps.isInputBlocked?.()) return false;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (consumesGameplayShortcut(event.target)) return false;

    const numericCode = event.code.startsWith('Digit')
      ? Number(event.code.slice(5))
      : event.code.startsWith('Numpad')
        ? Number(event.code.slice(6))
        : 0;
    const spellId = SPELL_IDS[numericCode - 1];
    if (!spellId) return false;
    event.preventDefault();
    cast(spellId);
    return true;
  };

  // Prefer attachSpellHotkeys() from the composition root *before* PlayerController
  // registers — it capture-stops every non-Escape key while walking. The optional
  // local listener remains for harnesses that construct the runtime in isolation.
  const onKeyDown = (event) => {
    if (handleKeyDown(event)) event.stopImmediatePropagation();
  };
  const registerKeys = deps.registerKeys !== false;
  if (registerKeys) {
    window.addEventListener('keydown', onKeyDown, true);
  }

  return {
    cast,
    handleKeyDown,
    syncMenuVisibility,
    update(nowMs) {
      if (!disposed) vfx.update(nowMs);
    },
    precompile(renderer) {
      if (!disposed) return vfx.precompile(renderer);
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (registerKeys) {
        window.removeEventListener('keydown', onKeyDown, true);
      }
      unsubscribeMode?.();
      menu.dispose();
      vfx.dispose();
    },
  };
}

/**
 * Capture-phase digit hotkeys must register before PlayerController, which
 * stopImmediatePropagates every non-Escape key while walking. Returns a dispose
 * function; `getHandler` is re-read each key so the runtime can bind late.
 *
 * @param {() => ((event: KeyboardEvent) => boolean) | null | undefined} getHandler
 * @param {Window | EventTarget} [target]
 */
export function attachSpellHotkeys(getHandler, target = window) {
  const onKeyDown = (event) => {
    if (getHandler()?.(event) === true) {
      event.stopImmediatePropagation();
    }
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
