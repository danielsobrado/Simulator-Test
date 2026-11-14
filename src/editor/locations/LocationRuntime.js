import * as THREE from 'three/webgpu';
import { LocationScene } from './LocationScene.js';

const STORAGE_KEY = 'drusniel_instanced_locations';
const IDLE = 'idle', TRANSITION = 'transition', INSIDE = 'inside';
const FAILURE_NOTICE_MS = 2600;

const nextPaint = () => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});

/**
 * Enters and leaves instanced locations.
 *
 * Three things stay separate: the world (which keeps its state and simply is
 * not drawn while the player is inside), the persisted record (which site is
 * active, the surface anchor to return to, per-site history), and the one
 * prepared `LocationScene`. A transition builds the destination completely
 * behind the loading screen and only then swaps, in one synchronous block — so
 * a failure at any stage leaves the player standing where they were.
 */
export class LocationRuntime {
  /**
   * @param {object} deps
   * @param {object} deps.catalog from `resolveLocationCatalog`
   * @param {Record<string, object>} deps.generators by generator key
   * @param {THREE.WebGPURenderer} deps.renderer
   * @param {import('../ui/LoadingTracker.js').LoadingTracker} deps.loading
   * @param {object} deps.playerController
   * @param {object} deps.viewModeController
   * @param {object} deps.cameraCutCoordinator
   * @param {object} deps.floatingOrigin
   * @param {{ show(text: string): void }} deps.prompt
   * @param {string} deps.baseUrl
   * @param {string} deps.walkMode the view mode id for walking
   * @param {Storage|null} [deps.storage]
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.storage = deps.storage ?? null;
    this.state = IDLE;
    this.current = null;
    this.anchor = null;
    this.worldRenderer = null;
    this.record = this.#read();
  }

  /** True while a location is what should be drawn instead of the world. */
  get active() {
    return this.current !== null;
  }

  get activeSiteId() {
    return this.current?.site.id ?? null;
  }

  get activeSite() {
    return this.current?.site ?? null;
  }

  #read() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      return { active: parsed?.active ?? null, sites: parsed?.sites ?? {} };
    } catch (error) {
      console.warn('Instanced location record was unreadable; starting clean.', error);
      return { active: null, sites: {} };
    }
  }

  #write() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.record));
    } catch (error) {
      console.warn('Could not persist instanced location state.', error);
    }
  }

  /** Where to put the player back: canonical world coordinates, never render-space ones. */
  #captureAnchor() {
    const view = this.viewModeController, player = this.playerController;
    const focus = view.readFocusWorld({ x: 0, z: 0 });
    const canonical = this.floatingOrigin.toCanonical(focus.x, focus.z);
    return { x: canonical.x, z: canonical.z, yaw: player.yaw, pitch: player.pitch, mode: view.mode };
  }

  #themeFor(site) {
    const tips = site.theme.tips ?? [];
    return {
      key: site.themeKey, subtitle: site.subtitle, color: site.theme.color, accent: site.theme.accent,
      tip: tips.length > 0 ? tips[(this.record.sites[site.id]?.visits ?? 0) % tips.length] : '',
    };
  }

  /**
   * Travels to a site. Resolves true once the player is standing in it, false if
   * another transition was running or this one failed (the player is then
   * wherever they were).
   */
  async enter(siteId, { spawnId = 'entry' } = {}) {
    if (this.state === TRANSITION) return false;
    const site = this.catalog.site(siteId);
    const generator = this.generators[site.generatorKey];
    const returnTo = this.state;
    this.state = TRANSITION;
    const player = this.playerController;
    const anchor = this.anchor ?? this.#captureAnchor();
    // Walk first, then open the loading screen: entering walk mode opens its own
    // streaming notice, and the newest loading session is the one shown.
    if (this.viewModeController.mode !== this.walkMode) {
      this.viewModeController.setMode(this.walkMode, { spawn: this.viewModeController.readFocusWorld({ x: 0, z: 0 }) });
    }
    player.cutBlocked = true;
    player.resetInput();
    this.prompt.show('');
    const session = this.loading.begin({
      title: site.title, steps: this.catalog.policy.phases, presentation: 'cinematic', theme: this.#themeFor(site),
    });
    let failed = null;
    try {
      session.start('resolve-manifest');
      await nextPaint();
      const next = await LocationScene.prepare({
        site, generator, quality: this.catalog.quality, baseUrl: this.baseUrl, renderer: this.renderer,
        camera: player.camera,
        progress: async (stepId) => { session.start(stepId); await nextPaint(); },
      });
      const spawn = next.spawns[spawnId] ?? next.spawns.entry;
      session.start('activate');
      // The swap: no await from here until the player stands in the new scene.
      const previous = this.current;
      this.#takeRenderer(site.lighting.exposure);
      this.current = next;
      this.anchor = anchor;
      next.nav.lastGround = spawn.y;
      player.groundOverride = next.nav;
      player.emit?.();
      // The hero's body lives in the world scene; inside a location the view is first person.
      if (this.viewModeController.isThirdPerson) this.viewModeController.toggleCameraView();
      player.placeAt(spawn);
      // World-only HUD pieces (streaming notice, scenic tour) hide while this is set.
      document.body.dataset.location = site.id;
      previous?.dispose();
      const history = this.record.sites[site.id] ?? { visits: 0 };
      this.record.sites[site.id] = { ...history, visits: history.visits + 1, discovered: true };
      this.record.active = { siteId: site.id, anchor };
      this.#write();
      this.state = INSIDE;
    } catch (error) {
      failed = error;
      console.error(`Entering location "${siteId}" failed; staying put.`, error);
      session.fail(error);
      this.state = returnTo;
    } finally {
      player.cutBlocked = false;
    }
    if (failed) await new Promise((resolve) => { setTimeout(resolve, FAILURE_NOTICE_MS); });
    session.finish();
    return !failed;
  }

  /** Leaves the active location for the surface anchor recorded on the way in. */
  async exit() {
    if (this.state !== INSIDE) return false;
    this.state = TRANSITION;
    const player = this.playerController, anchor = this.anchor, leaving = this.current;
    player.cutBlocked = true;
    player.resetInput();
    this.prompt.show('');
    const session = this.loading.begin({
      title: this.catalog.returnTheme.title, steps: this.catalog.policy.exitPhases, presentation: 'cinematic',
      theme: { ...this.catalog.returnTheme, subtitle: `Leaving ${leaving.site.title}` },
    });
    let failed = null;
    try {
      session.start('release');
      await nextPaint();
      // Swap back to the world before anything can fail: its frame loop must be running for the cut.
      this.current = null;
      this.anchor = null;
      player.groundOverride = null;
      delete document.body.dataset.location;
      this.#returnRenderer();
      const render = this.floatingOrigin.toRender(anchor.x, anchor.z);
      player.placeAt({ x: render.x, z: render.z, y: player.getGroundHeight(render.x, render.z), yaw: anchor.yaw, pitch: anchor.pitch });
      this.record.active = null;
      this.#write();
      leaving.dispose();
      session.start('return');
      if (anchor.mode === this.walkMode) {
        await this.cameraCutCoordinator.cut({ x: anchor.x, z: anchor.z, yaw: anchor.yaw, pitch: anchor.pitch, mode: 'player' });
      } else {
        this.viewModeController.setMode(anchor.mode);
      }
    } catch (error) {
      failed = error;
      console.error('Returning to the surface failed.', error);
      session.fail(error);
    } finally {
      player.cutBlocked = false;
      this.state = IDLE;
    }
    if (failed) await new Promise((resolve) => { setTimeout(resolve, FAILURE_NOTICE_MS); });
    session.finish();
    return !failed;
  }

  /** The world's post chain owns tone mapping; a location draws straight to the canvas and needs its own. */
  #takeRenderer(exposure) {
    const renderer = this.renderer;
    this.worldRenderer ??= { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure };
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
  }

  #returnRenderer() {
    if (!this.worldRenderer) return;
    this.renderer.toneMapping = this.worldRenderer.toneMapping;
    this.renderer.toneMappingExposure = this.worldRenderer.exposure;
    this.worldRenderer = null;
  }

  /** One frame of the active location, in place of the world's. */
  frame(timestamp) {
    const view = this.viewModeController;
    view.update(timestamp);
    const camera = view.camera;
    this.current.update(camera);
    this.renderer.render(this.current.scene, camera);
    if (this.state !== INSIDE) return;
    const feet = this.playerController.state;
    const exit = this.current.exitNear(feet.x, feet.footY ?? feet.y, feet.z);
    this.nearExit = exit;
    this.prompt.show(exit ? exit.label : '');
  }

  /** Capture-phase key handler. Inside a location the interact key belongs to it, not to the world's doors. */
  handleKey(event) {
    if (!this.active || event.code !== this.catalog.policy.interactCode) return;
    event.stopImmediatePropagation();
    if (!event.repeat && this.state === INSIDE && this.nearExit) void this.useExit(this.nearExit);
  }

  /** Takes a way out: on to the site it is linked to in the catalog, or back to the surface. */
  useExit(exit) {
    const link = this.current.site.links[exit.id];
    return link ? this.enter(link.site, { spawnId: link.spawn }) : this.exit();
  }

  /**
   * Resumes a session: `?location=<site>` opens that site; otherwise a save made
   * inside a location puts the player back in it, keeping its surface anchor.
   */
  async restore(search) {
    const requested = new URLSearchParams(search).get('location');
    const saved = this.record.active;
    try {
      if (requested) return await this.enter(requested);
      if (saved && this.catalog.sites.has(saved.siteId)) {
        this.anchor = saved.anchor;
        const entered = await this.enter(saved.siteId);
        if (!entered) { this.anchor = null; this.record.active = null; this.#write(); }
        return entered;
      }
    } catch (error) {
      console.error('Could not restore the instanced location.', error);
    }
    return false;
  }

  dispose() {
    this.current?.dispose();
    this.current = null;
    this.playerController.groundOverride = null;
    this.#returnRenderer();
  }
}
