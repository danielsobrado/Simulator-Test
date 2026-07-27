import { CharacterMotor } from './character/CharacterMotor.js';
import { subscribeCollisionComposition } from './CollisionPlayerBridge.js';
import { createCollisionRuntime } from './CollisionRuntime.js';
import { TerrainCollisionProvider } from './providers/TerrainCollisionProvider.js';

const params = new URLSearchParams(window.location.search);
const qaScenario = params.get('qa');
const qaMode = ['collision-p1', 'collision-p2', 'collision-p3'].includes(qaScenario);
let runtime = null;
let motor = null;
let player = null;
let frameId = null;
let sampleCandidateIds = null;
let p3Target = null;
let p3Positioned = false;
let disposed = false;

function publish(status) {
  if (!qaMode) return;
  const payload = Object.freeze({
    status,
    descriptor: runtime?.descriptor ?? null,
    collision: runtime?.getStatus() ?? null,
    motor: motor?.getStatus() ?? null,
    player: player?.getStatus() ?? null,
    sampleCandidateIds,
    target: p3Target,
  });
  if (qaScenario === 'collision-p1') window.__collisionP1Qa = payload;
  if (qaScenario === 'collision-p2') window.__collisionP2Qa = payload;
  if (qaScenario === 'collision-p3') window.__collisionP3Qa = payload;
}

function sampleCandidates() {
  if (sampleCandidateIds || !runtime?.descriptor?.entries?.length) return;
  const entry = runtime.descriptor.entries.find((candidate) => candidate.id === 'tree')
    ?? runtime.descriptor.entries[0];
  const ground = player.terrainView.getCanonicalHeight(entry.x, entry.z);
  sampleCandidateIds = Object.freeze(runtime.querySweptCapsule({
    start: { x: entry.x - 1, y: ground, z: entry.z },
    end: { x: entry.x + 1, y: ground, z: entry.z },
    radius: motor.config.radius,
    bodyHeight: motor.config.bodyHeight,
  }).map((collider) => collider.sourceId));
}

function positionP3Player(status) {
  if (qaScenario !== 'collision-p3' || p3Positioned) return false;
  const sample = status.provider?.sample;
  if (!sample) return false;
  const distance = sample.radius + motor.config.radius + 1.5;
  const render = player.terrainView.floatingOrigin.toRender(sample.x, sample.z + distance);
  p3Target = Object.freeze({ ...sample });
  p3Positioned = true;
  player.setPose({ x: render.x, z: render.z, yaw: 0, pitch: 0 });
  return true;
}

function updateQa() {
  if (disposed || !qaMode) return;
  if (window.__editor && runtime) {
    window.__editor.collision = runtime;
    window.__editor.characterMotor = motor;
  }
  const status = runtime?.getStatus();
  if (status?.residency.ready) {
    if (positionP3Player(status)) {
      publish('positioning');
    } else {
      sampleCandidates();
      publish('ready');
    }
  } else {
    publish('building');
  }
  frameId = requestAnimationFrame(updateQa);
}

function attach({ player: nextPlayer, collisionConfig, treeSource }) {
  if (disposed || runtime || !nextPlayer?.terrainView || !nextPlayer.config) return;
  const requiresTrees = qaScenario === 'collision-p3'
    || (collisionConfig.enabled && collisionConfig.trees.enabled);
  if (requiresTrees && !treeSource) {
    publish('waiting-trees');
    return;
  }

  player = nextPlayer;
  runtime = createCollisionRuntime({
    terrainView: player.terrainView,
    editorConfig: { collision: collisionConfig, player: player.config },
    treeSource,
    search: window.location.search,
  });
  if (!runtime) {
    publish('inactive');
    return;
  }

  const terrainProvider = new TerrainCollisionProvider({
    getHeight: (x, z) => player.terrainView.getCanonicalHeight(x, z),
    sampleDistance: collisionConfig.player.radius,
  });
  motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider,
    config: collisionConfig.player,
    stepHeight: player.config.stepHeight,
    groundSnapDistance: player.config.groundSnapDistance,
  });
  player.attachCollision({ runtime, motor });
  publish('building');
  if (qaMode) frameId = requestAnimationFrame(updateQa);
}

if (qaMode) publish('waiting');
const unsubscribe = subscribeCollisionComposition(attach);

window.addEventListener('pagehide', () => {
  disposed = true;
  unsubscribe();
  if (frameId !== null) cancelAnimationFrame(frameId);
  player?.detachCollision?.();
  motor?.dispose();
  runtime?.dispose();
  motor = null;
  runtime = null;
  player = null;
}, { once: true });
