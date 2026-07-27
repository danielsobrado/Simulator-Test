import { createCollisionRuntime } from './CollisionRuntime.js';

const params = new URLSearchParams(window.location.search);
const qaMode = params.get('qa') === 'collision-p1';
let runtime = null;
let frameId = null;
let disposed = false;
let sampleCandidateIds = null;

function publish(status) {
  if (!qaMode) return;
  window.__collisionP1Qa = Object.freeze({
    status,
    descriptor: runtime?.descriptor ?? null,
    collision: runtime?.getStatus() ?? null,
    sampleCandidateIds,
  });
}

function sampleCandidates(editor) {
  if (sampleCandidateIds || !runtime?.descriptor?.entries?.length) return;
  const entry = runtime.descriptor.entries.find((candidate) => candidate.id === 'tree')
    ?? runtime.descriptor.entries[0];
  const ground = editor.controller.terrainView.getCanonicalHeight(entry.x, entry.z);
  sampleCandidateIds = Object.freeze(runtime.querySweptCapsule({
    start: { x: entry.x - 1, y: ground, z: entry.z },
    end: { x: entry.x + 1, y: ground, z: entry.z },
    radius: editor.config.collision.player.radius,
    bodyHeight: editor.config.collision.player.bodyHeight,
  }).map((collider) => collider.sourceId));
}

function update(editor, timestamp) {
  if (disposed) return;
  const focus = editor.controller.focusProvider?.();
  if (focus) runtime.update(focus, timestamp);
  const status = runtime.getStatus();
  if (status.residency.ready) {
    sampleCandidates(editor);
    publish('ready');
  } else {
    publish('building');
  }
  frameId = requestAnimationFrame((nextTimestamp) => update(editor, nextTimestamp));
}

function attach() {
  if (disposed) return;
  const editor = window.__editor;
  if (!editor?.controller?.terrainView || !editor.config) {
    frameId = requestAnimationFrame(attach);
    return;
  }
  runtime = createCollisionRuntime({
    terrainView: editor.controller.terrainView,
    editorConfig: editor.config,
    search: window.location.search,
  });
  if (!runtime) {
    publish('inactive');
    return;
  }
  editor.collision = runtime;
  publish('building');
  frameId = requestAnimationFrame((timestamp) => update(editor, timestamp));
}

if (!import.meta.env.DEV) {
  if (qaMode) publish('unavailable');
} else {
  if (qaMode) publish('waiting');
  frameId = requestAnimationFrame(attach);
}

window.addEventListener('pagehide', () => {
  disposed = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  runtime?.dispose();
  runtime = null;
}, { once: true });
