import locationsSource from '../../../config/instanced-locations.yaml?compiled';
import mineTimberSource from '../../../config/mine-timber.yaml?compiled';
import { TownInteractionPrompt } from '../towns/TownInteractionPrompt.js';
import { setDefaultMineTimberConfig } from './gen/mineTimberConfig.js';
import { LOCATION_GENERATORS } from './generators/index.js';
import { resolveLocationCatalog } from './LocationCatalog.js';
import { LocationRuntime } from './LocationRuntime.js';
import { LocationDevMenu } from './ui/LocationDevMenu.js';

/**
 * Wires instanced locations into the editor: the catalog from YAML, the
 * transition runtime, the interact prompt and key, and the development menu
 * that stands in for world entrances until sites are anchored to the map.
 *
 * @returns {{ runtime: LocationRuntime, dispose(): void }}
 */
export function createLocationRuntime({
  renderer, loading, playerController, viewModeController, cameraCutCoordinator, floatingOrigin, walkMode, baseUrl,
  search = window.location.search, storage = window.localStorage,
}) {
  setDefaultMineTimberConfig(mineTimberSource);
  const catalog = resolveLocationCatalog(structuredClone(locationsSource), {
    generatorKeys: Object.keys(LOCATION_GENERATORS),
    quality: new URLSearchParams(search).get('locationQuality'),
  });
  const prompt = new TownInteractionPrompt();
  const runtime = new LocationRuntime({
    catalog, generators: LOCATION_GENERATORS, renderer, loading, playerController, viewModeController,
    cameraCutCoordinator, floatingOrigin, prompt, baseUrl, walkMode, storage,
  });
  const menu = new LocationDevMenu({
    sites: catalog.showcaseSites().map((site) => ({ id: site.id, title: site.title, subtitle: site.subtitle })),
    onEnter: (siteId) => runtime.enter(siteId),
    onExit: () => runtime.exit(),
    getActiveSiteId: () => runtime.activeSiteId,
    toggleCode: catalog.policy.devMenuCode,
  });
  const onKey = (event) => runtime.handleKey(event);
  window.addEventListener('keydown', onKey, true);
  return {
    runtime,
    dispose() {
      window.removeEventListener('keydown', onKey, true);
      menu.dispose();
      prompt.dispose();
      runtime.dispose();
    },
  };
}
