import { createCollisionP0QaScene } from './CollisionP0QaScene.js';

const params = new URLSearchParams(window.location.search);
const enabled = ['collision-p0', 'collision-p1'].includes(params.get('qa'));

if (enabled && !import.meta.env.DEV) {
  window.__collisionP0Qa = Object.freeze({ status: 'unavailable' });
}

if (enabled && import.meta.env.DEV) {
  let fixture = null;
  let stopped = false;

  const attach = () => {
    if (stopped || fixture) return;
    const editor = window.__editor;
    const terrainView = editor?.controller?.terrainView;
    const config = editor?.config;
    if (!terrainView || !config?.collision) {
      requestAnimationFrame(attach);
      return;
    }

    fixture = createCollisionP0QaScene({
      terrainView,
      playerConfig: config.player,
      collisionConfig: config.collision,
    });
    window.__collisionP0Qa = Object.freeze({
      status: 'ready',
      descriptor: fixture.descriptor,
    });
  };

  window.__collisionP0Qa = Object.freeze({ status: 'waiting' });
  requestAnimationFrame(attach);
  window.addEventListener('pagehide', () => {
    stopped = true;
    fixture?.dispose();
    fixture = null;
  }, { once: true });
}
