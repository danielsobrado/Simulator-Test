/**
 * Builds the player's character from `character.hero`: the procedural drow, or
 * an authored roster character. Both expose the same surface (`update`,
 * `setVisible`, `shiftWorld`, `prewarm`, `beginCastAlongCamera`, `dispose`), so
 * the composition root never branches on which one it holds.
 */

import { CharacterView } from './CharacterView.js';
import { GlbCharacterView } from './glb/GlbCharacterView.js';
import { HERO_KIND_PROCEDURAL, resolveHeroCharacter } from './glb/CharacterRoster.js';
import { createStylizedSceneLoader } from '../stylized/StylizedSceneAssetCache.js';

/**
 * @param {object} options
 * @param {import('three').Scene} options.scene
 * @param {{ heightAt(x: number, z: number): number }} options.terrain
 * @param {import('three').Vector3} options.sunDirection
 * @param {object} options.config the `character` section, plus `runSpeed`
 * @param {() => object | null} [options.getWeatherSettings]
 * @param {object | null} [options.loader] a GLTF loader already set up for
 *   Meshopt and KTX2; one is created (and owned by the view) when absent
 * @param {object} [options.renderer] needed only when `loader` is absent
 * @param {string} [options.baseUrl]
 */
export function createCharacterView({
  scene,
  terrain,
  sunDirection,
  config,
  getWeatherSettings = null,
  loader = null,
  renderer = null,
  baseUrl = '/',
}) {
  const hero = resolveHeroCharacter(config);
  if (hero.kind === HERO_KIND_PROCEDURAL) {
    return new CharacterView({ scene, terrain, sunDirection, config, getWeatherSettings });
  }
  const owned = loader ? null : createStylizedSceneLoader({ renderer });
  return new GlbCharacterView({
    scene,
    terrain,
    hero,
    loader: loader ?? owned.loader,
    baseUrl,
    runSpeed: config.runSpeed,
    enabled: config.enabled !== false,
    contactShadow: config.contactShadow !== false,
    onDispose: owned ? owned.release : null,
  });
}
