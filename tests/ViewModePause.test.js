import assert from 'node:assert/strict';
import test from 'node:test';
import { ESCAPE_PRIORITY, EscapeStack } from '../src/editor/ui/EscapeStack.js';

/**
 * Stand-ins for the two controllers. `ViewModeController` needs a canvas and a
 * terrain view to construct, which this repo has no DOM harness for — but the
 * behaviour worth pinning is the *ordering*, which lives in the escape stack
 * and in the pause/resume contract.
 */
function createPlayer() {
  return {
    paused: false,
    physicsSteps: 0,
    keysSwallowed: 0,
    pose: { x: 12, z: -4, yaw: 1.2 },
    setPaused(paused) {
      this.paused = Boolean(paused);
    },
    update() {
      if (this.paused) return;
      this.physicsSteps += 1;
    },
    onKeyDown() {
      if (this.paused) return false;
      this.keysSwallowed += 1;
      return true;
    },
  };
}

function createViewMode(player) {
  return {
    mode: 'player',
    paused: false,
    player,
    onPausedEditing: null,
    pause() {
      if (this.mode !== 'player' || this.paused) return false;
      this.paused = true;
      this.player.setPaused(true);
      this.onPausedEditing?.();
      return true;
    },
    resume() {
      if (!this.paused) return false;
      this.paused = false;
      this.player.setPaused(false);
      return true;
    },
    setMode(mode) {
      this.resume();
      this.mode = mode;
    },
  };
}

function createTarget() {
  const listeners = [];
  return {
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler) {
      const index = listeners.findIndex((entry) => entry.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    press() {
      const event = {
        key: 'Escape',
        code: 'Escape',
        target: { tagName: 'CANVAS' },
        propagationStopped: false,
        preventDefault() {},
        stopImmediatePropagation() { this.propagationStopped = true; },
      };
      for (const entry of [...listeners]) {
        if (entry.type !== 'keydown') continue;
        entry.handler(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
}

/** The wiring `main.js` installs, in the same order. */
function wire(stack, { viewMode, palette, controller }) {
  stack.register(ESCAPE_PRIORITY.palette, () => {
    if (!palette.isOpen) return false;
    palette.isOpen = false;
    return true;
  });
  stack.register(ESCAPE_PRIORITY.gesture, () => {
    if (!controller.gesture) return false;
    controller.gesture = false;
    return true;
  });
  stack.register(ESCAPE_PRIORITY.selection, () => {
    if (!controller.selection) return false;
    controller.selection = null;
    return true;
  });
  stack.register(ESCAPE_PRIORITY.playerPaused, () => {
    if (!viewMode.paused) return false;
    viewMode.setMode('edit');
    return true;
  });
  stack.register(ESCAPE_PRIORITY.playerWalking, () => viewMode.pause());
}

function harness() {
  const player = createPlayer();
  const viewMode = createViewMode(player);
  const palette = { isOpen: false };
  const controller = { gesture: false, selection: null };
  const target = createTarget();
  const stack = new EscapeStack({ target });
  wire(stack, { viewMode, palette, controller });
  return { player, viewMode, palette, controller, target, stack };
}

test('escape while walking pauses into editing rather than leaving player mode', () => {
  const { viewMode, player, target } = harness();
  let pausedEditingCalls = 0;
  viewMode.onPausedEditing = () => { pausedEditingCalls += 1; };
  target.press();
  assert.equal(viewMode.paused, true);
  assert.equal(viewMode.mode, 'player', 'pausing must not leave player mode');
  assert.equal(player.paused, true);
  assert.equal(pausedEditingCalls, 1, 'pause must force the construction tool hook');
});

test('escape while paused returns to the orbit editor', () => {
  const { viewMode, player, target } = harness();
  viewMode.pause();
  target.press();
  assert.equal(viewMode.mode, 'edit');
  assert.equal(viewMode.paused, false);
  assert.equal(player.paused, false, 'leaving must un-pause the player controller');
});

test('escape always backs out exactly one level', () => {
  // The failure mode being designed away is Escape behaving as a toggle: from
  // paused it must reach the editor, never resume walking.
  const { viewMode, palette, controller, target } = harness();
  viewMode.pause();
  palette.isOpen = true;
  controller.gesture = true;
  controller.selection = 'construction-1';

  target.press();
  assert.equal(palette.isOpen, false, 'first press closes the palette');
  assert.equal(viewMode.paused, true, 'and nothing else');

  target.press();
  assert.equal(controller.gesture, false, 'second press cancels the gesture');
  assert.equal(viewMode.paused, true);

  target.press();
  assert.equal(controller.selection, null, 'third press deselects');
  assert.equal(viewMode.paused, true);

  target.press();
  assert.equal(viewMode.mode, 'edit', 'fourth press leaves paused editing');
});

test('a paused player runs no physics and swallows no keys', () => {
  const { viewMode, player } = harness();
  player.update();
  player.onKeyDown();
  assert.equal(player.physicsSteps, 1);
  assert.equal(player.keysSwallowed, 1);

  viewMode.pause();
  player.update();
  player.update();
  assert.equal(player.physicsSteps, 1, 'physics must be frozen while paused');
  assert.equal(player.onKeyDown(), false, 'keys must reach the editor');
  assert.equal(player.keysSwallowed, 1);

  viewMode.resume();
  player.update();
  assert.equal(player.physicsSteps, 2, 'resuming restarts physics');
});

test('pausing preserves the pose so resuming puts the player back', () => {
  const { viewMode, player } = harness();
  const before = { ...player.pose };
  viewMode.pause();
  viewMode.resume();
  assert.deepEqual(player.pose, before);
});

test('re-entering player mode resumes rather than respawning', () => {
  const { viewMode, player } = harness();
  viewMode.pause();
  viewMode.setMode('player');
  assert.equal(viewMode.paused, false);
  assert.equal(player.paused, false);
});

test('pause is refused outside player mode', () => {
  const { viewMode } = harness();
  viewMode.setMode('edit');
  assert.equal(viewMode.pause(), false);
  assert.equal(viewMode.paused, false);
});

test('resume is idempotent', () => {
  const { viewMode } = harness();
  assert.equal(viewMode.resume(), false);
  viewMode.pause();
  assert.equal(viewMode.resume(), true);
  assert.equal(viewMode.resume(), false);
});
