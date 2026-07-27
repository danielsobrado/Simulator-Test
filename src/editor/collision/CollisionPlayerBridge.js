let currentPlayer = null;
let currentConfig = null;
const listeners = new Set();

function publish() {
  if (!currentPlayer || !currentConfig) return;
  const composition = Object.freeze({
    player: currentPlayer,
    collisionConfig: currentConfig,
  });
  for (const listener of listeners) listener(composition);
}

export function registerCollisionConfig(config) {
  if (!config) throw new Error('Collision config registration requires a config.');
  currentConfig = config;
  publish();
}

export function registerCollisionPlayer(player) {
  if (!player) throw new Error('Collision player registration requires a controller.');
  currentPlayer = player;
  publish();
  return () => {
    if (currentPlayer === player) currentPlayer = null;
  };
}

export function subscribeCollisionComposition(listener) {
  if (typeof listener !== 'function') {
    throw new Error('Collision composition subscription requires a listener.');
  }
  listeners.add(listener);
  if (currentPlayer && currentConfig) {
    listener(Object.freeze({
      player: currentPlayer,
      collisionConfig: currentConfig,
    }));
  }
  return () => listeners.delete(listener);
}
