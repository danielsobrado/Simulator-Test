import { CharacterMotor } from './character/CharacterMotor.js';
import { subscribeCollisionComposition } from './CollisionPlayerBridge.js';
import { createCollisionRuntime } from './CollisionRuntime.js';
import { TerrainCollisionProvider } from './providers/TerrainCollisionProvider.js';

const params = new URLSearchParams(window.location.search);
const qaScenario = params.get('qa');
const fixtureQa = qaScenario === 'collision-p1' || qaScenario === 'collision-p2';
const productionQa = qaScenario === 'collision-p3'
  || qaScenario === 'collision-p4'
  || qaScenario === 'collision-p5'
  || qaScenario === 'collision-p6'
  || qaScenario === 'collision-p7'
  || qaScenario === 'collision-p8';
const qaMode = fixtureQa || productionQa;
let runtime = null;
let motor = null;
let player = null;
let frameId = null;
let sampleCandidateIds = null;
let qaTarget = null;
let targetPositioned = false;
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
    target: qaTarget,
  });
  if (qaScenario === 'collision-p1') window.__collisionP1Qa = payload;
  if (qaScenario === 'collision-p2') window.__collisionP2Qa = payload;
  if (qaScenario === 'collision-p3') window.__collisionP3Qa = payload;
  if (qaScenario === 'collision-p4') window.__collisionP4Qa = payload;
  if (qaScenario === 'collision-p5') window.__collisionP5Qa = payload;
  if (qaScenario === 'collision-p6') window.__collisionP6Qa = payload;
  if (qaScenario === 'collision-p7') window.__collisionP7Qa = payload;
  if (qaScenario === 'collision-p8') window.__collisionP8Qa = payload;
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

function productionSample(status) {
  if (qaScenario === 'collision-p3') return status.provider?.sample ?? null;
  if (qaScenario === 'collision-p4' || qaScenario === 'collision-p5') {
    return status.provider?.rockSample ?? null;
  }
  if (qaScenario === 'collision-p6') {
    return status.provider?.components?.objects?.sample ?? null;
  }
  if (qaScenario === 'collision-p7') {
    return status.provider?.components?.constructions?.sample ?? null;
  }
  return null;
}

function positionProductionPlayer(status) {
  if (!productionQa || targetPositioned || qaScenario === 'collision-p8') return false;
  const sample = productionSample(status);
  if (!sample) return false;
  if (qaScenario === 'collision-p5' && sample.tier !== 'walkable') return false;
  const distance = sample.radius + motor.config.radius + 1.5;
  const render = player.terrainView.floatingOrigin.toRender(sample.x, sample.z + distance);
  qaTarget = Object.freeze({ ...sample });
  targetPositioned = true;
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
  if (status?.failure) {
    publish('failed');
  } else if (status?.residency.ready) {
    if (qaScenario === 'collision-p8') {
      qaTarget ??= Object.freeze({
        kind: 'release-hardening',
        canonicalSignature: status.canonicalSignature,
      });
      sampleCandidates();
      publish('ready');
    } else if (productionQa && !qaTarget) {
      if (positionProductionPlayer(status)) publish('positioning');
      else if (qaScenario === 'collision-p3') publish('waiting-trees');
      else if (qaScenario === 'collision-p5') publish('waiting-walkable-rocks');
      else if (qaScenario === 'collision-p6') publish('waiting-objects');
      else if (qaScenario === 'collision-p7') publish('waiting-constructions');
      else publish('waiting-rocks');
    } else {
      sampleCandidates();
      publish('ready');
    }
  } else {
    publish('building');
  }
  frameId = requestAnimationFrame(updateQa);
}

function attach({
  player: nextPlayer,
  collisionConfig,
  treeSource,
  objectSource,
  constructionSource,
}) {
  if (disposed || runtime || !nextPlayer?.terrainView || !nextPlayer.config) return;
  const p8NeedsNatural = qaScenario === 'collision-p8'
    && (collisionConfig.trees.enabled || collisionConfig.rocks.enabled);
  const naturalQa = ['collision-p3', 'collision-p4', 'collision-p5'].includes(qaScenario)
    || p8NeedsNatural;
  const requiresNaturalSource = naturalQa
    || (!fixtureQa && collisionConfig.enabled
      && (collisionConfig.trees.enabled || collisionConfig.rocks.enabled));
  if (requiresNaturalSource && !treeSource) {
    publish('waiting-natural-props');
    return;
  }
  const requiresObjectSource = qaScenario === 'collision-p6'
    || (qaScenario === 'collision-p8' && collisionConfig.objects.enabled)
    || (!fixtureQa && collisionConfig.enabled && collisionConfig.objects.enabled);
  if (requiresObjectSource && !objectSource) {
    publish('waiting-placed-objects');
    return;
  }
  const requiresConstructionSource = qaScenario === 'collision-p7'
    || (qaScenario === 'collision-p8' && collisionConfig.constructions.enabled)
    || (!fixtureQa && collisionConfig.enabled && collisionConfig.constructions.enabled);
  if (requiresConstructionSource && !constructionSource) {
    publish('waiting-constructions');
    return;
  }

  player = nextPlayer;
  runtime = createCollisionRuntime({
    terrainView: player.terrainView,
    editorConfig: { collision: collisionConfig, player: player.config },
    treeSource,
    objectSource,
    constructionSource,
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
