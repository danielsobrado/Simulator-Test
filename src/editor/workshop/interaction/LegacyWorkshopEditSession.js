import { WorkshopHistory } from '../history/WorkshopHistory.js';
import { WorkshopCommandBus } from '../kernel/WorkshopCommandBus.js';
import { WorkshopDocument } from '../kernel/WorkshopDocument.js';
import { cloneWorkshopProperties } from '../kernel/WorkshopEntity.js';
import {
  legacyWorkshopEditStateCommand,
  legacyWorkshopEditStateFromDocument,
} from './LegacyWorkshopEditStateAdapter.js';
import { WorkshopToolController } from './WorkshopToolController.js';

const LEGACY_COMPONENT_TOOL_ID = 'legacy-component-edit';
const LEGACY_RECIPE_ROOT = Object.freeze({
  id: 'recipe',
  type: 'workshop-recipe',
  parentId: null,
  properties: Object.freeze({}),
  dependsOn: Object.freeze([]),
});

function normalizeState(state = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Legacy workshop edit session state must be an object.');
  }
  return cloneWorkshopProperties({
    componentTransforms: state.componentTransforms ?? {},
    openingAttachments: state.openingAttachments ?? {},
    openingAssemblies: state.openingAssemblies ?? {},
  }, 'Legacy workshop edit session state');
}

function sameState(left, right) {
  return JSON.stringify(normalizeState(left)) === JSON.stringify(normalizeState(right));
}

export class LegacyWorkshopEditSession {
  #bus;
  #history;
  #tool;
  #gestureLabel = null;

  constructor(initialState = {}) {
    this.#bus = new WorkshopCommandBus(new WorkshopDocument({ entities: [LEGACY_RECIPE_ROOT] }));
    const initialCommand = legacyWorkshopEditStateCommand(this.#bus.document, normalizeState(initialState), {
      label: 'Initialize component edit state',
    });
    if (initialCommand.commands.length > 0) this.#bus.dispatch(initialCommand);
    this.#history = new WorkshopHistory(this.#bus);
    this.#tool = new WorkshopToolController({ bus: this.#bus });
  }

  get state() {
    return legacyWorkshopEditStateFromDocument(this.#bus.document);
  }

  get canUndo() {
    return this.#history.canUndo;
  }

  get canRedo() {
    return this.#history.canRedo;
  }

  get isGestureActive() {
    return this.#tool.isGestureActive;
  }

  synchronize(state) {
    if (this.isGestureActive) {
      throw new Error('Cannot synchronize component edit state during an active gesture.');
    }
    if (sameState(this.state, state)) return false;
    const command = legacyWorkshopEditStateCommand(this.#bus.document, normalizeState(state), {
      label: 'Synchronize component edit state',
    });
    if (command.commands.length > 0) this.#tool.execute(command);
    this.#history.clear();
    return true;
  }

  beginGesture(beforeState, { label = 'Component gesture' } = {}) {
    this.synchronize(beforeState);
    this.#tool.beginGesture(LEGACY_COMPONENT_TOOL_ID, { label });
    this.#gestureLabel = label;
    return this.state;
  }

  previewState(state, { label = 'Component gesture' } = {}) {
    if (!this.isGestureActive) throw new Error('No component gesture is active.');
    const command = legacyWorkshopEditStateCommand(this.#bus.document, normalizeState(state), {
      label: this.#gestureLabel ?? label,
    });
    this.#tool.updateGesture(command);
    return legacyWorkshopEditStateFromDocument(this.#tool.previewDocument);
  }

  record(beforeState, afterState, { label = 'Component edit' } = {}) {
    if (this.isGestureActive) {
      if (!sameState(this.state, beforeState)) {
        throw new Error('Component gesture baseline no longer matches committed semantic state.');
      }
    } else {
      this.synchronize(beforeState);
    }
    if (sameState(beforeState, afterState)) {
      if (this.isGestureActive) this.#tool.cancelGesture();
      this.#gestureLabel = null;
      return null;
    }
    const command = legacyWorkshopEditStateCommand(this.#bus.document, normalizeState(afterState), {
      label: this.#gestureLabel ?? label,
    });
    if (this.isGestureActive) {
      this.#tool.updateGesture(command);
      const result = this.#tool.commitGesture();
      this.#gestureLabel = null;
      return result;
    }
    return this.#tool.execute(command);
  }

  cancelGesture() {
    if (!this.isGestureActive) return this.state;
    this.#tool.cancelGesture();
    this.#gestureLabel = null;
    return this.state;
  }

  undo() {
    if (this.isGestureActive) this.cancelGesture();
    const result = this.#history.undo();
    return result ? this.state : null;
  }

  redo() {
    if (this.isGestureActive) this.cancelGesture();
    const result = this.#history.redo();
    return result ? this.state : null;
  }

  dispose() {
    if (this.isGestureActive) this.cancelGesture();
    this.#history.dispose();
  }
}
