let currentPlayer = null;
let currentConfig = null;
let currentTreeSource = null;
const listeners = new Set();

function composition() {
  if (!currentPlayer || !currentConfig) return null;
  return Object.freeze({
    player: currentPlayer,
    collisionConfig: currentConfig,
    treeSource: currentTreeSource,
  });
}

function publish() {
  const value = composition();
  if (!value) return;
  for (const listener of listeners) listener(value);
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

export function registerCollisionTreeSource(source) {
  if (!source?.treeView) {
    throw new Error('Collision tree-source registration requires an initialized tree view.');
  }
  currentTreeSource = Object.freeze({
    treeView: source.treeView,
    rockSource: source.rockSource ?? null,
  });
  publish();
  return () => {
    if (currentTreeSource?.treeView !== source.treeView) return;
    currentTreeSource = null;
    publish();
  };
}

export function subscribeCollisionComposition(listener) {
  if (typeof listener !== 'function') {
    throw new Error('Collision composition subscription requires a listener.');
  }
  listeners.add(listener);
  const value = composition();
  if (value) listener(value);
  return () => listeners.delete(listener);
}
