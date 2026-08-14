const params = new URLSearchParams(window.location.search);
const enabled = ['collision-p0', 'collision-p1', 'collision-p2'].includes(params.get('qa'));

if (enabled && !import.meta.env.DEV) {
  window.__collisionP0Qa = Object.freeze({ status: 'unavailable' });
}

if (enabled && import.meta.env.DEV) {
  let fixture = null;
  let stopped = false;
  let sceneModulePromise = null;

  const fail = (error) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    stopped = true;
    console.error('Collision P0 QA fixture failed to load.', failure);
    window.__collisionP0Qa = Object.freeze({
      status: 'failed',
      error: failure.message,
    });
  };

  const attach = async () => {
    if (stopped || fixture) return;
    const editor = window.__editor;
    const terrainView = editor?.controller?.terrainView;
    const config = editor?.config;
    if (!terrainView || !config?.collision) {
      requestAnimationFrame(() => void attach());
      return;
    }

    try {
      sceneModulePromise ??= import('./CollisionP0QaScene.js');
      const { createCollisionP0QaScene } = await sceneModulePromise;
      if (stopped || fixture) return;
      fixture = createCollisionP0QaScene({
        terrainView,
        playerConfig: config.player,
        collisionConfig: config.collision,
      });
      window.__collisionP0Qa = Object.freeze({
        status: 'ready',
        descriptor: fixture.descriptor,
      });
    } catch (error) {
      fail(error);
    }
  };

  window.__collisionP0Qa = Object.freeze({ status: 'waiting' });
  requestAnimationFrame(() => void attach());
  window.addEventListener('pagehide', () => {
    stopped = true;
    fixture?.dispose();
    fixture = null;
  }, { once: true });
}