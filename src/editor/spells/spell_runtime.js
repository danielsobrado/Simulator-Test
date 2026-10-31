import * as THREE from 'three';
import { attachCaptureHotkey } from '../input/attachCaptureHotkey.js';
import { createSpellSoundSynth } from '../vfx/audio/SpellSoundSynth.js';
import { createVfxSystem } from '../vfx/VfxSystem.js';
import { earthSpellGameplayConfig } from './earth_spell_gameplay_config.js';
import { createGrimoireCaster } from './grimoire/createGrimoireCaster.js';
import { GRIMOIRE_PAGES } from './grimoire/grimoireCatalog.js';
import { defaultSpellConfig } from './spell_config.js';
import { createSpellMenu } from './spell_menu.js';
import { createSpellVfxController } from './spell_vfx_controller.js';

const FIREBALL_COLLISION_PROBE_PADDING_M = 1.5;
const FIREBALL_COLLISION_PROBE_SECONDS = 0.075;
const PAGE_KEYS = Object.freeze({ BracketLeft: -1, BracketRight: 1 });
const MAX_FRAME_DELTA_S = 0.1;

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
    const started = typeof play === 'function' ? play(durationMs) : false;
    if (started) deps.onCast?.(spellId);
    return started;
  };

  // The grimoire: procedural VFX spells (src/editor/vfx), on their own dock pages.
  const effects = deps.groundHeight ? createVfxSystem({
    scene,
    groundHeight: deps.groundHeight,
    getSceneLights: deps.getSceneLights,
    pressGround: deps.pressGround,
    markGround: deps.markGround,
    sound: createSpellSoundSynth(),
  }) : null;
  const unsubscribeOrigin = effects && typeof deps.subscribeOriginShift === 'function'
    ? deps.subscribeOriginShift((event) => effects.shiftOrigin(event.shiftX, event.shiftZ))
    : null;
  const grimoire = effects ? createGrimoireCaster({
    vfx: effects,
    getCamera,
    raycastTerrain: (ray, maxRange) => deps.raycastTerrain?.(ray, maxRange) ?? null,
    groundHeight: deps.groundHeight,
    getCasterFeet: deps.getCasterFeet,
  }) : null;
  let lastUpdateMs = null;

  const castGrimoire = (spellId) => {
    if (disposed || !grimoire || !isCastMode() || deps.isInputBlocked?.()) return false;
    const started = grimoire.cast(spellId);
    if (started) deps.onCast?.(spellId);
    return started;
  };

  const menu = createSpellMenu({
    config,
    root: deps.menuRoot,
    extraPages: grimoire ? GRIMOIRE_PAGES : [],
    castExtra: castGrimoire,
    canCast: deps.vitals ? (castMs) => deps.vitals.canCast(castMs) : undefined,
    onCast: deps.vitals ? (castMs) => deps.vitals.spendCast(castMs) : undefined,
    controller: {
      playFire: (durationMs) => cast('fire', durationMs),
      playWater: (durationMs) => cast('water', durationMs),
      playAir: (durationMs) => cast('air', durationMs),
      playEarth: (durationMs) => cast('earth', durationMs),
      playLightning: (durationMs) => cast('lightning', durationMs),
      playFireball: (durationMs) => cast('fireball', durationMs),
    },
  });

  const unsubscribeVitals = deps.vitals?.subscribe(() => menu.syncAvailability());

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

    const pageDelta = PAGE_KEYS[event.code];
    if (pageDelta) {
      event.preventDefault();
      menu.cyclePage(pageDelta);
      return true;
    }
    const numericCode = event.code.startsWith('Digit')
      ? Number(event.code.slice(5))
      : event.code.startsWith('Numpad')
        ? Number(event.code.slice(6))
        : 0;
    const slot = numericCode - 1;
    if (slot < 0 || !menu.hasSlot(slot)) return false;
    event.preventDefault();
    // Through the dock, so a key cast lights its slot and plays the cast sound
    // exactly like a click; the dock calls back into `cast` or `castGrimoire`.
    menu.castSlot(slot);
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
    castGrimoire,
    handleKeyDown,
    syncMenuVisibility,
    /** The procedural VFX stack, for QA probes. */
    effects,
    update(nowMs) {
      if (disposed) return;
      vfx.update(nowMs);
      if (effects) {
        const deltaSeconds = lastUpdateMs === null ? 0 : (nowMs - lastUpdateMs) / 1000;
        lastUpdateMs = nowMs;
        effects.update(Math.min(MAX_FRAME_DELTA_S, Math.max(0, deltaSeconds)), getCamera());
      }
    },
    async precompile(renderer) {
      if (disposed) return false;
      const compiled = await vfx.precompile(renderer);
      if (effects) await effects.precompile(renderer, getCamera());
      return compiled;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (registerKeys) {
        window.removeEventListener('keydown', onKeyDown, true);
      }
      unsubscribeMode?.();
      unsubscribeVitals?.();
      unsubscribeOrigin?.();
      menu.dispose();
      vfx.dispose();
      effects?.dispose();
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
  return attachCaptureHotkey(getHandler, target);
}
