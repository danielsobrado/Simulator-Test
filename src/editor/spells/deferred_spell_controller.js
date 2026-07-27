function createDeferredSpellController(target, ready = Promise.resolve(), schedule = (task) => window.setTimeout(task, 0), cancel = (taskId) => window.clearTimeout(taskId)) {
  const pending = /* @__PURE__ */ new Set();
  let disposed = false;
  const enqueue = (task) => {
    void ready.finally(() => {
      if (disposed) return;
      const taskId = schedule(() => {
        pending.delete(taskId);
        if (!disposed) task();
      });
      pending.add(taskId);
    });
  };
  return {
    controller: {
      playFire: (durationMs) => enqueue(() => target.playFire(durationMs)),
      playWater: (durationMs) => enqueue(() => target.playWater(durationMs)),
      playAir: (durationMs) => enqueue(() => target.playAir(durationMs)),
      playEarth: (durationMs) => {
        enqueue(() => target.playEarth(durationMs));
        return true;
      },
      playLightning: (durationMs) => enqueue(() => target.playLightning(durationMs)),
      playFireball: (durationMs) => enqueue(() => target.playFireball(durationMs)),
      update: (nowMs) => target.update(nowMs),
      precompile: (renderer) => target.precompile(renderer),
      dispose: () => void 0
    },
    dispose() {
      disposed = true;
      for (const taskId of pending) cancel(taskId);
      pending.clear();
    }
  };
}
export {
  createDeferredSpellController
};
