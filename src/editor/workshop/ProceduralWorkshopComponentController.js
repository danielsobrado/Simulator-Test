import { ProceduralWorkshopComponentController as LegacyProceduralWorkshopComponentController } from './LegacyProceduralWorkshopComponentController.js';
import { LegacyWorkshopEditSession } from './interaction/LegacyWorkshopEditSession.js';

// TODO: Migrate remaining Three.js helper and manipulation slices out of the legacy core as semantic equivalents become authoritative.
export class ProceduralWorkshopComponentController extends LegacyProceduralWorkshopComponentController {
  constructor(options) {
    super(options);
    this.semanticEditSession = new LegacyWorkshopEditSession(this.captureEditState());
    this.installSemanticDragLifecycle();
    this.updateHistoryButtons();
  }

  installSemanticDragLifecycle() {
    this.transformControls.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.onDraggingChanged = ({ value }) => {
      this.dragging = value;
      this.orbitControls.enabled = !value;
      if (value) {
        this.dragStartTransforms = this.captureEditState();
        this.semanticEditSession.beginGesture(this.dragStartTransforms, {
          label: 'Transform component',
        });
        return;
      }
      this.commitSelectedTransform(this.dragStartTransforms);
      this.dragStartTransforms = null;
    };
    this.transformControls.addEventListener('dragging-changed', this.onDraggingChanged);
  }

  updateHistoryButtons() {
    if (this.undoButton) this.undoButton.disabled = !this.semanticEditSession?.canUndo;
    if (this.redoButton) this.redoButton.disabled = !this.semanticEditSession?.canRedo;
  }

  recordHistory(before) {
    if (!before || !this.semanticEditSession) return null;
    const result = this.semanticEditSession.record(before, this.captureEditState());
    this.updateHistoryButtons();
    return result;
  }

  undo() {
    if (this.dragging || this.boundaryDrag) return false;
    if (this.attachmentMode) super.cancelAttachmentPlacement();
    const state = this.semanticEditSession?.undo();
    if (!state) return false;
    super.restoreTransformDocument(state);
    this.updateHistoryButtons();
    return true;
  }

  redo() {
    if (this.dragging || this.boundaryDrag) return false;
    if (this.attachmentMode) super.cancelAttachmentPlacement();
    const state = this.semanticEditSession?.redo();
    if (!state) return false;
    super.restoreTransformDocument(state);
    this.updateHistoryButtons();
    return true;
  }

  beginBoundaryDrag(event, handle) {
    const started = super.beginBoundaryDrag(event, handle);
    if (!started) return false;
    try {
      this.semanticEditSession.beginGesture(this.boundaryDrag.before, {
        label: 'Reshape component',
      });
    } catch (error) {
      super.finishBoundaryDrag(false, event);
      throw error;
    }
    return true;
  }

  finishBoundaryDrag(commit, event) {
    if (!commit && this.boundaryDrag && this.semanticEditSession?.isGestureActive) {
      this.boundaryDrag.before = this.semanticEditSession.cancelGesture();
    }
    return super.finishBoundaryDrag(commit, event);
  }

  beginAttachmentPlacement() {
    const wasActive = this.attachmentMode;
    const active = super.beginAttachmentPlacement();
    if (!wasActive && active) {
      try {
        this.semanticEditSession.beginGesture(this.captureEditState(), {
          label: 'Place opening',
        });
      } catch (error) {
        super.cancelAttachmentPlacement();
        throw error;
      }
    } else if (wasActive && !active && this.semanticEditSession?.isGestureActive) {
      this.semanticEditSession.cancelGesture();
    }
    return active;
  }

  cancelAttachmentPlacement() {
    const wasActive = this.attachmentMode;
    const cancelled = super.cancelAttachmentPlacement();
    if (wasActive && this.semanticEditSession?.isGestureActive) {
      this.semanticEditSession.cancelGesture();
    }
    return cancelled;
  }

  replaceParts(parts) {
    const result = super.replaceParts(parts);
    if (this.semanticEditSession) {
      this.semanticEditSession.synchronize(this.captureEditState());
      this.updateHistoryButtons();
    }
    return result;
  }

  clear() {
    if (this.semanticEditSession?.isGestureActive) this.semanticEditSession.cancelGesture();
    return super.clear();
  }

  dispose() {
    super.dispose();
    this.semanticEditSession?.dispose();
    this.semanticEditSession = null;
  }
}
