import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import editorSource from '../../../../editor.config.yaml?compiled';
import weatherSource from '../../../../config/weather-effects.yaml?compiled';
import ambientSource from '../../../../config/ambient-effects.yaml?compiled';
import { resolveWeatherEffects } from '../../weather/WeatherEffectsConfig.js';
import { SnowWeatherSystem } from '../../weather/snow_system.js';
import { resolveAmbientEffectsConfig } from '../../stylized/ambient/ambientEffectsConfig.js';
import { AmbientEffectsSystem } from '../../stylized/ambient/AmbientEffectsSystem.js';
import { SnowPowderKicks } from '../../stylized/powder/SnowPowderKicks.js';
import { createAuthoredTrunkMaterial, createStylizedLeafMaterial } from '../../stylized/StylizedTreeMaterials.js';
import { createStylizedSceneLoader } from '../../stylized/StylizedSceneAssetCache.js';

/** Real authored crowns and production particle shaders on a bounded QA valley. */
export async function createSnowBiomeFixtureEffects({ renderer, scene, sun, fill, groundHeight }) {
  const config = structuredClone(editorSource.stylizedSurface);
  const trees = new THREE.Group(); trees.name = 'qa-snowy-alpine-trees'; scene.add(trees);
  const definitions = config.assets.treeVariants.filter(variant => variant.scene.includes('/alpine/'));
  const { loader, release } = createStylizedSceneLoader({ renderer });
  for (const [i, definition] of definitions.entries()) {
    const gltf = await loader.loadAsync(definition.scene);
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      const count = mesh.geometry.attributes.position.count;
      mesh.geometry.setAttribute('instanceDither', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const morphology = new Float32Array(count * 3).fill(1);
      mesh.geometry.setAttribute('instanceMorphology', new THREE.BufferAttribute(morphology, 3));
      const source = mesh.material;
      mesh.material = source.name === definition.leafMaterial
        ? createStylizedLeafMaterial({ source, config, bounds: { minY: bounds.min.y, maxY: bounds.max.y },
          time: uniform(0), preserveSourceColor: true, vertexColor: Boolean(mesh.geometry.attributes.color) })
        : createAuthoredTrunkMaterial({ source, sourceMap: source.map });
    });
    gltf.scene.scale.setScalar(definition.scale);
    const x = i === 0 ? -6 : 7, z = -5 - i * 3;
    gltf.scene.position.set(x, groundHeight(x, z), z); trees.add(gltf.scene);
  }
  release();
  const snow = new SnowWeatherSystem({ scene, isWebGpu: true, seed: 0x51eaf00d,
    snowfall: resolveWeatherEffects(weatherSource).snowfall });
  snow.applySettings({ enabled: false, intensity: 0, windX: -0.62, windZ: 0.21 });
  const settings = resolveAmbientEffectsConfig(ambientSource.ambientEffects);
  settings.fields = settings.fields.filter(field => ['diamondDust', 'spindrift'].includes(field.name));
  const ambient = new AmbientEffectsSystem({ scene, settings, getTile: () => 10, getTileSize: () => 2,
    getWater: () => null, getGroundHeight: groundHeight, sunDirection: uniform(sun.position.clone().normalize()) });
  const powder = new SnowPowderKicks({ scene, sunDirection: sun.position.clone().normalize() });
  const ambientState = { focus: { x: 0, y: 1.7, z: 0 }, origin: { x: 0, z: 0 }, presetName: 'sunny',
    wind: { x: -0.62, z: 0.21, strength: 0.6 }, snowCountry: 1, seaLevel: -100 };
  ambient.setLight({ sunColor: sun.color, sunIntensity: sun.intensity, skyColor: fill.color, skyIntensity: fill.intensity });
  for (let i = 0; i < 60; i++) ambient.update(0.1, ambientState);
  powder.update(0);
  for (const x of [-0.35, 0.35]) powder.kick({ x, y: 0, z: 0, facing: 0, speed: 7 });
  return {
    trees,
    capture(kind, camera) {
      const biome = kind.startsWith('biome');
      trees.visible = biome;
      snow.group.visible = biome && kind.includes('snowfall');
      snow.snowMaterial.setIntensity(1);
      snow.snowMaterial.setCenter(camera.position);
      snow.snowMaterial.setTime(kind.endsWith('moving') ? 6.5 : 6);
      Object.assign(ambientState.focus, { x: camera.position.x, y: camera.position.y, z: camera.position.z });
      ambient.update(0.1, ambientState);
      ambient.root.visible = biome && kind.includes('particles');
      powder.mesh.visible = kind.startsWith('powder-kick');
      powder.uniforms.time.value = kind.endsWith('settled') ? 3 : 0.3;
      return { trees: trees.children.length, fields: ambient.getState(), flakes: snow.getStats().flakes };
    },
  };
}
