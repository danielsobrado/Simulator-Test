import { constructionCollisionSource } from './providers/ConstructionCollisionSource.js';

let currentPlayer = null;
let currentConfig = null;
let currentNaturalSource = null;
let currentObjectSource = null;
let currentConstructionSource = constructionCollisionSource;
const listeners = new Set();

function composition() {
  if (!currentPlayer || !currentConfig) return null;
  return Object.freeze({
    player: currentPlayer,
    collisionConfig: currentConfig,
    treeSource: currentNaturalSource,
    objectSource: currentObjectSource,
    constructionSource: currentConstructionSource,
  });
}

function notify(listener, value) {
  try {
    listener(value);
  } catch (error) {
    console.error('Collision composition listener failed.', error);
  }
}

function publish() {
  const value = composition();
  if (!value) return;
  for (const listener of listeners) notify(listener, value);
}

export function registerCollisionConfig(config) {
  if (!config) throw new Error('Collision config registration requires a config.');
  constructionCollisionSource.setConfig(config.constructions);
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

export function registerCollisionNaturalSource(source) {
  if (!source?.treeView && !source?.rockSource) {
    throw new Error('Collision natural-source registration requires trees or rocks.');
  }
  const registered = Object.freeze({
    treeView: source.treeView ?? null,
    rockSource: source.rockSource ?? null,
  });
  currentNaturalSource = registered;
  publish();
  return () => {
    if (currentNaturalSource !== registered) return;
    currentNaturalSource = null;
    publish();
  };
}

export function registerCollisionObjectSource(source) {
  if (!source?.objectMap || !source?.placementResolver || !Array.isArray(source?.objectCatalog)) {
    throw new Error('Collision object-source registration requires map, resolver, and catalog.');
  }
  const registered = Object.freeze({
    objectMap: source.objectMap,
    placementResolver: source.placementResolver,
    objectCatalog: source.objectCatalog,
    tileSize: source.tileSize,
  });
  currentObjectSource = registered;
  publish();
  return () => {
    if (currentObjectSource !== registered) return;
    currentObjectSource = null;
    publish();
  };
}

export function registerCollisionConstructionSource(source) {
  if (!source?.list || !source?.getPlan || !source?.signature) {
    throw new Error('Collision construction-source registration requires compiled plans.');
  }
  currentConstructionSource = source;
  publish();
  return () => {
    if (currentConstructionSource !== source) return;
    currentConstructionSource = constructionCollisionSource;
    publish();
  };
}

export function registerCollisionTreeSource(source) {
  return registerCollisionNaturalSource(source);
}

export function subscribeCollisionComposition(listener) {
  if (typeof listener !== 'function') {
    throw new Error('Collision composition subscription requires a listener.');
  }
  listeners.add(listener);
  const value = composition();
  if (value) notify(listener, value);
  return () => listeners.delete(listener);
}