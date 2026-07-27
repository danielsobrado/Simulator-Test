import { CharacterMotor } from './character/CharacterMotor.js';
import { subscribeCollisionComposition } from './CollisionPlayerBridge.js';
import { createCollisionRuntime } from './CollisionRuntime.js';
import { TerrainCollisionProvider } from './providers/TerrainCollisionProvider.js';

const params = new URLSearchParams(window.location.search);
const qaScenario = params.get('qa');
const qaMode = qaScenario === 'collision-p1' || qaScenario === 'collision-p2';
let runtime = null;
let motor = null;
let player = null;
let frameId = null;
let sampleCandidateIds = null;
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
  });
  if (qaScenario === 'collision-p1') window.__collisionP1Qa = payload;
  if (qaScenario === 'collision-p2') window.__collisionP2Qa = payload;
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

function updateQa() {
  if (disposed || !qaMode) return;
  if (window.__editor && runtime) {
    window.__editor.collision = runtime;
    window.__editor.characterMotor = motor;
  }
  const status = runtime?.getStatus();
  if (status?.residency.ready) {
    sampleCandidates();
    publish('ready');
  } else {
    publish('building');
  }
  frameId = requestAnimationFrame(updateQa);
}

function attach({ player: nextPlayer, collisionConfig }) {
  if (disposed || runtime || !nextPlayer?.terrainView || !nextPlayer.config) return;
  player = nextPlayer;
  runtime = createCollisionRuntime({
    terrainView: player.terrainView,
    editorConfig: { collision: collisionConfig, player: player.config },
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
