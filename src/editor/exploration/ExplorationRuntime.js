import { PLAYER_MODE_WALK } from '../player/playerConstants.js';
import { SettlementResidents } from '../actors/SettlementResidents.js';
import { SerpentSystem } from '../wildlife/SerpentSystem.js';
import { MobileControls } from '../player/MobileControls.js';
import { usesMobileProfile } from './MobileProfile.js';
import { ScenicTour } from './ScenicTour.js';
import { pressGrassUnderCreatures } from './creatureGrassPress.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

/** Owns the transplanted exploration systems and their viewport UI. */
export class ExplorationRuntime {
  constructor({ config, terrainView, viewModeController, container, sceneLoader = null, onInstalled, invalidateHistory, grass = () => null }) {
    // `grass()` is the meadow field, read each frame: it is rebuilt with the world.
    Object.assign(this, { config, terrainView, viewModeController, grass });
    this.lastTimestamp = null; this.mobile = null;
    this.residents = new SettlementResidents({ scene: terrainView.scene, terrainView,
      roster: config.character.roster, settings: config.exploration.residents,
      baseUrl: import.meta.env.BASE_URL, loader: sceneLoader, onInstalled });
    this.serpents = new SerpentSystem({ scene: terrainView.scene, terrainView, settings: config.exploration.serpents, onInstalled });
    this.tour = new ScenicTour({ terrainView, viewModeController, settings: config.exploration.tour, container, invalidateHistory });
    viewModeController.onBeforeModeChange = () => this.tour.stop();
    this.container = container;
    this.onResize = () => this.syncMobile(); window.addEventListener('resize', this.onResize); this.syncMobile();
  }
  syncMobile() {
    const enabled = usesMobileProfile(this.config.exploration.mobile);
    const player = this.viewModeController.playerController;
    if (enabled && !this.mobile) {
      this.mobile = new MobileControls({ container: this.container, lookSensitivity: this.config.exploration.mobile.lookSensitivity,
        onMove: (x, z) => player.setMobileInput({ right: x, forward: -z }),
        onLook: (yaw, pitch) => player.lookMobile(yaw, pitch),
        onSprint: running => player.setMobileInput({ running }),
        onAscend: ascend => player.setMobileInput({ ascend }), onDescend: descend => player.setMobileInput({ descend }),
        onRecenter: () => player.cameraFollow.recenter(player.cameraFollow.headingYaw ?? player.yaw) });
    } else if (!enabled && this.mobile) { this.mobile.destroy(); this.mobile = null; player.resetInput(); }
    player.setMobileInput({ enabled }); this.syncMobileVisibility();
  }
  syncMobileVisibility() {
    const view = this.viewModeController;
    this.mobile?.setVisible(view.mode === PLAYER_MODE_WALK && !view.paused && !view.playerController.uiBlocked && !this.tour.active);
  }
  beforeMovement(timestamp) {
    this.deltaSeconds = this.lastTimestamp === null ? 0 : Math.min(0.1, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp; this.tour.update(this.deltaSeconds); this.syncMobileVisibility();
  }
  update(timestamp, focus, playerBody, budget = null) {
    const camera = this.viewModeController.camera;
    this.residents.update(this.deltaSeconds, camera, focus, timestamp, budget);
    this.serpents.update(this.deltaSeconds, camera, focus, playerBody, timestamp);
    const grass = this.grass();
    PerfCounters.set('creatureGrassPresses', grass ? pressGrassUnderCreatures({
      press: (x, z, radius) => grass.pressBody(x, z, radius), playerBody, reach: grass.pressReach,
      walkers: this.residents.npcs.entries.values(),
      serpents: Array.from(this.serpents.entries.values(), entry => entry.serpent),
    }) : 0);
  }
  shiftWorld(x, z) { this.residents.shiftWorld(); this.serpents.shiftWorld(); this.tour.shiftWorld(x, z); }
  dispose() {
    window.removeEventListener('resize', this.onResize); this.mobile?.destroy(); this.mobile = null;
    this.viewModeController.playerController.setMobileInput({ enabled: false });
    this.tour.dispose(); this.residents.dispose(); this.serpents.dispose();
    this.viewModeController.onBeforeModeChange = null;
  }
}
