import { WaterInteractionState } from '../water/WaterInteractionState.js';
import { RIPPLE_REACH_METRES } from '../water/RippleField.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

/** Metres the surface is pushed down by a full-strength wade or swim stroke. */
const WAKE_DEPTH = 0.014;
const WAKE_WIDTH = 0.3;
/** One ambient drop: an insect, a drip off the canopy. */
const DROP_DEPTH = 0.004;
const DROP_WIDTH = 0.1;
/** Metres a spell's press pushes the surface down at full strength. */
const PRESS_DEPTH = 0.007;
/** A press held at one radius (a puddle, a rune) stirs its rim this much as hard. */
const HELD_SHARE = 0.2;

/**
 * The player's and spells' disturbances of the water, fed to the ripple field
 * (water/RippleField.js) with the region's ripple settings
 * (biomes/BiomeSurfaceResponse.js). Nothing is drawn here: the water material
 * reads the field.
 */
export class WaterInteractionSurface {
  constructor({ terrainView, player, config, rippleField, random = Math.random }) {
    this.view = terrainView; this.player = player; this.config = config; this.field = rippleField;
    this.random = random;
    this.state = new WaterInteractionState(); this.status = {}; this.origin = {}; this.canonical = {}; this.render = {};
    this.generator = terrainView.worldStore.generator;
    this.lastSeconds = null; this.splashed = new WeakSet(); this.dropDebt = 0; this.lastPress = null;
    this.settings = { speed: 1.4, fade: 3, splash: 1, drops: 0 };
    this.release = player.subscribeWaterEvents(event => {
      if (!this.enabled || !this.active) return;
      const origin = terrainView.floatingOrigin.readState(this.origin);
      this.state.event(event, { x: player.state.x + origin.x, z: player.state.z + origin.z });
    });
  }
  get enabled() { return this.config.enabled !== false && this.config.qualityTier !== 'low' && this.config.interaction?.enabled !== false; }

  /**
   * A spell pressing the ground (EffectDirector `press`), in render space. A
   * growing disc is a blast racing out as a ring wave; one held at a radius
   * keeps its rim stirring.
   */
  press(x, z, radius, strength, inner = 0.6) {
    if (!this.enabled) return;
    const origin = this.view.floatingOrigin.readState(this.origin);
    const held = this.lastPress && Math.abs(this.lastPress.radius - radius) < 0.05
      && Math.hypot(this.lastPress.x - x, this.lastPress.z - z) < 0.05;
    this.lastPress = { x, z, radius };
    const depth = PRESS_DEPTH * strength * this.settings.splash * (held ? HELD_SHARE : 1);
    this.field.splash(x + origin.x, z + origin.z, -depth, { ring: radius * inner, width: radius * (1 - inner) * 0.5 + 0.2 });
  }

  update(seconds, active = true, settings = this.settings) {
    const started = performance.now(); this.active = active; this.settings = settings;
    const dt = this.lastSeconds === null ? 0 : Math.min(0.25, Math.max(0, seconds - this.lastSeconds));
    this.lastSeconds = seconds;
    if (this.generator !== this.view.worldStore.generator) { this.state.clear(); this.generator = this.view.worldStore.generator; }
    this.player.readFrameStatus(this.status);
    const origin = this.view.floatingOrigin.readState(this.origin);
    this.canonical.x = this.status.position.x + origin.x; this.canonical.z = this.status.position.z + origin.z;
    this.render.x = this.status.position.x; this.render.z = this.status.position.z;
    const enabled = this.enabled;
    const impulses = this.state.update(seconds, this.canonical, this.status, enabled && active);
    for (const impulse of impulses) {
      if (this.splashed.has(impulse)) continue;
      this.splashed.add(impulse);
      this.field.splash(impulse.x, impulse.z, -WAKE_DEPTH * impulse.strength * settings.splash, { width: WAKE_WIDTH });
    }
    this.dropDebt += settings.drops * dt;
    for (; enabled && this.dropDebt >= 1; this.dropDebt -= 1) {
      const angle = this.random() * Math.PI * 2, distance = Math.sqrt(this.random()) * RIPPLE_REACH_METRES[0];
      this.field.splash(this.canonical.x + Math.cos(angle) * distance, this.canonical.z + Math.sin(angle) * distance,
        -DROP_DEPTH * (0.5 + this.random()), { width: DROP_WIDTH });
    }
    this.dropDebt = Math.min(this.dropDebt, 1);
    this.field.update(dt, this.canonical, this.render, { speed: settings.speed, fade: settings.fade, enabled });
    PerfCounters.set('waterInteractionActive', enabled ? impulses.length : 0);
    PerfCounters.set('waterInteractionCpuMs', performance.now() - started);
  }
  dispose() { this.release?.(); this.state.clear(); this.field.dispose(); }
}
