import * as THREE from 'three';
import { createPropBillboardGeometry } from '../_clod_shims/prop_billboard.js';
import { createAirNodeMaterial } from './air_node_material.js';
import { createEarthSpellVfx } from './earth_spell_vfx.js';
import { createFireNodeMaterial } from './fire_node_material.js';
import { createFireballSpellVfx } from './fireball_spell_vfx.js';
import { createLightningSpellVfx } from './lightning_spell_vfx.js';
import { precompileSpellObjects } from './spell_precompiler.js';
import { createWaterNodeMaterial } from './water_node_material.js';

const ENABLE_VISIBLE_FALLBACK = false;
const FALLBACK_BASE_OPACITY = 0.72;
const SPELL_LIGHT_ENVELOPE = Object.freeze({
  castInEnd: 0.12,
  castOutStart: 0.72,
  pulseStrength: 0.08,
  pulseCycles: 8,
});
const SPELL_VISIBLE_PROGRESS_FLOOR = 0.035;

function createPoseScratch() {
  return {
    worldUp: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector3(),
    right: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    base: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  };
}

function createOrientationScratch() {
  return {
    yAxis: new THREE.Vector3(),
    cameraToBase: new THREE.Vector3(),
    zAxis: new THREE.Vector3(),
    xAxis: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
  };
}

function createFrameScratch() {
  return { active: false, progress: 0, timeSeconds: 0 };
}

function resolveSpellPose(camera, vfx, scratch = createPoseScratch()) {
  camera.getWorldDirection(scratch.aim).normalize();
  scratch.right.crossVectors(scratch.aim, scratch.worldUp);
  if (scratch.right.lengthSq() < 1e-6) scratch.right.set(1, 0, 0);
  else scratch.right.normalize();
  scratch.camUp.crossVectors(scratch.right, scratch.aim).normalize();
  scratch.base
    .copy(camera.position)
    .addScaledVector(scratch.aim, vfx.handForwardM)
    .addScaledVector(scratch.right, vfx.handRightM)
    .addScaledVector(scratch.camUp, vfx.handUpM);
  scratch.dir.copy(scratch.aim);
  return scratch;
}

function createSpellPoseResolver(deps) {
  const scratch = createPoseScratch();
  return () => resolveSpellPose(deps.camera, deps.vfx, scratch);
}

function orientFireJet(
  base,
  direction,
  cameraPosition,
  target = new THREE.Quaternion(),
  scratch = createOrientationScratch(),
) {
  const yAxis = scratch.yAxis.copy(direction).normalize();
  const cameraToBase = scratch.cameraToBase.copy(cameraPosition).sub(base);
  const zAxis = scratch.zAxis
    .copy(cameraToBase)
    .addScaledVector(yAxis, -cameraToBase.dot(yAxis));
  if (zAxis.lengthSq() < 1e-8) {
    zAxis.set(Math.abs(yAxis.y) < 0.99 ? 0 : 1, Math.abs(yAxis.y) < 0.99 ? 1 : 0, 0);
    zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis));
  }
  zAxis.normalize();
  scratch.xAxis.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(scratch.xAxis, yAxis).normalize();
  scratch.matrix.makeBasis(scratch.xAxis, yAxis, zAxis);
  return target.setFromRotationMatrix(scratch.matrix);
}

function computeSpellFrame(startMs, durationMs, nowMs, target = createFrameScratch()) {
  const elapsed = nowMs - startMs;
  const progress = elapsed / Math.max(1, durationMs);
  target.active = progress < 1;
  target.progress = progress;
  target.timeSeconds = elapsed / 1000;
  return target;
}

function computeSpellLightEnvelope(progress) {
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const castIn = Math.min(1, boundedProgress / SPELL_LIGHT_ENVELOPE.castInEnd);
  const castOut = 1 - Math.min(
    1,
    Math.max(
      0,
      (boundedProgress - SPELL_LIGHT_ENVELOPE.castOutStart)
        / (1 - SPELL_LIGHT_ENVELOPE.castOutStart),
    ),
  );
  const pulse = 1 - SPELL_LIGHT_ENVELOPE.pulseStrength * 0.5
    + Math.sin(
      boundedProgress * Math.PI * 2 * SPELL_LIGHT_ENVELOPE.pulseCycles,
    ) * SPELL_LIGHT_ENVELOPE.pulseStrength * 0.5;
  return Math.min(1, Math.max(0, castIn * castOut * pulse));
}

function spellLightColor(color) {
  return new THREE.Color(color[0], color[1], color[2]);
}

function createFallbackSpellMesh(name, geometry, color) {
  if (!ENABLE_VISIBLE_FALLBACK) return null;
  const material = new THREE.MeshBasicMaterial({
    name: 'spell-visible-fallback',
    color: spellLightColor(color),
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name}-fallback`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4001;
  mesh.visible = false;
  return mesh;
}

export function createSpellVfxController(deps) {
  const { scene, getCamera } = deps;
  const now = deps.now ?? (() => performance.now());
  let disposed = false;

  const buildSpell = (name, handle, config) => {
    const geometry = createPropBillboardGeometry(
      config.worldWidth * config.flameScale,
      config.worldHeight * config.flameScale,
    );
    handle.material.transparent = true;
    handle.material.depthWrite = false;
    handle.material.depthTest = false;
    handle.material.side = THREE.FrontSide;
    handle.material.toneMapped = false;

    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4000;
    mesh.visible = false;

    const fallbackMesh = createFallbackSpellMesh(name, geometry, config.glowColor);
    const light = new THREE.PointLight(
      spellLightColor(config.glowColor),
      0,
      config.glowDistance,
      config.glowDecay,
    );
    light.name = `${name}-glow`;
    light.position.set(
      0,
      config.worldHeight * config.flameScale * config.glowLocalYRatio,
      0,
    );
    light.visible = false;
    mesh.add(light);
    scene.add(mesh);
    if (fallbackMesh) scene.add(fallbackMesh);

    return {
      mesh,
      fallbackMesh,
      light,
      baseLightIntensity: config.glowIntensity,
      handle,
      config,
      poseScratch: createPoseScratch(),
      orientationScratch: createOrientationScratch(),
      frameScratch: createFrameScratch(),
      startMs: 0,
      durationMs: 0,
      active: false,
    };
  };

  const fire = buildSpell('fire-spell', createFireNodeMaterial(), deps.fire);
  const water = buildSpell('water-spell', createWaterNodeMaterial(), deps.water);
  const air = buildSpell('air-spell', createAirNodeMaterial(), deps.air);
  const earth = createEarthSpellVfx({
    scene,
    config: deps.earth,
    getTarget: deps.getEarthTarget,
    getCamera,
    now,
  });

  const lightningConfig = deps.lightning;
  const lightningPoseScratch = createPoseScratch();
  const lightningSource = { point: lightningPoseScratch.base, direction: lightningPoseScratch.dir };
  const lightning = lightningConfig ? createLightningSpellVfx({
    scene,
    config: lightningConfig,
    getCamera,
    getSource: () => {
      resolveSpellPose(getCamera(), lightningConfig, lightningPoseScratch);
      return lightningSource;
    },
    getTarget: deps.getLightningTarget ?? (() => null),
    now,
  }) : null;

  const fireballConfig = deps.fireball;
  const fireballPoseScratch = createPoseScratch();
  const fireballSource = { point: fireballPoseScratch.base, direction: fireballPoseScratch.dir };
  const fireball = fireballConfig && deps.raycastFireballTerrain ? createFireballSpellVfx({
    scene,
    config: fireballConfig,
    getSource: () => {
      resolveSpellPose(getCamera(), fireballConfig, fireballPoseScratch);
      return fireballSource;
    },
    raycastTerrain: deps.raycastFireballTerrain,
    now,
  }) : null;

  const spells = [fire, water, air];

  const hideBeamSpell = (spell) => {
    spell.active = false;
    spell.light.intensity = 0;
    spell.light.visible = false;
    spell.mesh.visible = false;
    if (spell.fallbackMesh) {
      spell.fallbackMesh.visible = false;
      spell.fallbackMesh.material.opacity = 0;
    }
  };

  const tick = (spell, nowMs) => {
    if (!spell.active) return;
    const frame = computeSpellFrame(
      spell.startMs,
      spell.durationMs,
      nowMs,
      spell.frameScratch,
    );
    if (!frame.active) {
      hideBeamSpell(spell);
      return;
    }

    const visibleProgress = Math.max(frame.progress, SPELL_VISIBLE_PROGRESS_FLOOR);
    spell.handle.uTime.value = frame.timeSeconds;
    spell.handle.uProgress.value = visibleProgress;
    spell.light.intensity = spell.baseLightIntensity
      * computeSpellLightEnvelope(visibleProgress);

    const camera = getCamera();
    const pose = resolveSpellPose(camera, spell.config, spell.poseScratch);
    spell.mesh.position.copy(pose.base);
    orientFireJet(
      pose.base,
      pose.dir,
      camera.position,
      spell.mesh.quaternion,
      spell.orientationScratch,
    );

    if (spell.fallbackMesh) {
      spell.fallbackMesh.visible = true;
      spell.fallbackMesh.material.opacity = FALLBACK_BASE_OPACITY
        * computeSpellLightEnvelope(visibleProgress);
      spell.fallbackMesh.scale.setScalar(1 + Math.sin(frame.timeSeconds * 12) * 0.04);
      spell.fallbackMesh.position.copy(pose.base);
      spell.fallbackMesh.quaternion.copy(spell.mesh.quaternion);
    }
  };

  const start = (spell, durationMs) => {
    const startMs = now();
    spell.startMs = startMs;
    spell.durationMs = Math.max(1, Number(durationMs) || 1);
    spell.active = true;
    spell.handle.uTime.value = 0;
    spell.handle.uProgress.value = SPELL_VISIBLE_PROGRESS_FLOOR;
    spell.light.intensity = spell.baseLightIntensity
      * computeSpellLightEnvelope(SPELL_VISIBLE_PROGRESS_FLOOR);
    spell.light.visible = true;
    spell.mesh.visible = true;
    if (spell.fallbackMesh) {
      spell.fallbackMesh.visible = true;
      spell.fallbackMesh.material.opacity = FALLBACK_BASE_OPACITY;
      spell.fallbackMesh.scale.setScalar(1);
    }
    tick(spell, startMs + 16);
    return true;
  };

  return {
    playFire: (durationMs) => start(fire, durationMs),
    playWater: (durationMs) => start(water, durationMs),
    playAir: (durationMs) => start(air, durationMs),
    playEarth: (durationMs) => earth.play(durationMs) !== false,
    playLightning: (durationMs) => lightning ? lightning.play(durationMs) !== false : false,
    playFireball: (durationMs) => fireball ? fireball.play(durationMs) !== false : false,
    update(nowMs) {
      if (disposed) return;
      const frameNow = typeof nowMs === 'number' && nowMs > 1000 ? nowMs : now();
      for (const spell of spells) tick(spell, frameNow);
      earth.update(frameNow);
      lightning?.update(frameNow);
      fireball?.update(frameNow);
    },
    precompile(renderer) {
      return precompileSpellObjects(renderer, scene, getCamera());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const spell of spells) {
        scene.remove(spell.mesh);
        spell.mesh.geometry.dispose();
        spell.handle.material.dispose();
        if (spell.fallbackMesh) {
          scene.remove(spell.fallbackMesh);
          spell.fallbackMesh.material.dispose();
        }
      }
      earth.dispose();
      lightning?.dispose();
      fireball?.dispose();
    },
  };
}

export {
  computeSpellFrame,
  computeSpellLightEnvelope,
  createSpellPoseResolver,
  orientFireJet,
  resolveSpellPose,
};
