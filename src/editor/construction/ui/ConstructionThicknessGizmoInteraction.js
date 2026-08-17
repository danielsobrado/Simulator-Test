import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { CONSTRUCTION_DIRECT_GIZMO_CONFIG as CONFIG } from '../config/ConstructionDirectGizmoConfig.generated.js';
import { ConstructionGizmoController } from './ConstructionGizmoController.js';

const PATCH_MARK = Symbol.for('drusniel.construction-thickness-gizmo');
const PRIMARY_POINTER_BUTTON = 0;
const EPSILON = 1e-6;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function arcTableFor(record) {
  if (!record || record.path?.type !== 'cubicBezier') return null;
  return createCurveArcTable(sampleCubicBezierPath(record.path));
}

function installConstructionThicknessGizmo() {
  const prototype = ConstructionGizmoController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const pointerDown = prototype.onDirectPointerDown;
  prototype.onDirectPointerDown = function thicknessPointerDown(event) {
    if (
      event.button !== PRIMARY_POINTER_BUTTON
      || this.directDrag
      || !this.directView
      || this.controller.tool !== 'construction'
      || this.controller.constructionMode !== 'edit'
    ) {
      return pointerDown.call(this, event);
    }

    this.syncDirectGizmo();
    const hit = this.directView.pick(event.clientX, event.clientY, this.controller.activeCamera);
    if (hit?.kind !== 'thickness') return pointerDown.call(this, event);

    const before = this.selectedRecord();
    const arcTable = arcTableFor(before);
    const frame = this.directView.thicknessFrame(before, arcTable);
    if (!before || !arcTable || !frame || !Number.isFinite(hit.direction)) return;
    const startPoint = this.directView.canonicalPointOnHorizontalPlane(
      event.clientX,
      event.clientY,
      this.controller.activeCamera,
      frame.y,
    );
    if (!startPoint) return;

    this.directDrag = {
      kind: 'thickness',
      pointerId: event.pointerId,
      constructionId: before.id,
      anchorId: this.controller.selectedAnchorId,
      before,
      arcTable,
      startThickness: before.dimensions.thickness,
      direction: hit.direction,
      normalX: frame.normalX,
      normalZ: frame.normalZ,
      planeY: frame.y,
      startPoint,
      candidate: null,
    };
    this.consumeDirectEvent(event);
    this.canvas?.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = prototype.onDirectPointerMove;
  prototype.onDirectPointerMove = function thicknessPointerMove(event) {
    const drag = this.directDrag;
    if (!drag || drag.kind !== 'thickness') return pointerMove.call(this, event);
    if (event.pointerId !== drag.pointerId || !this.directView) return;
    this.consumeDirectEvent(event);

    const point = this.directView.canonicalPointOnHorizontalPlane(
      event.clientX,
      event.clientY,
      this.controller.activeCamera,
      drag.planeY,
    );
    if (!point) return;
    const alongNormal = (point.x - drag.startPoint.x) * drag.normalX
      + (point.z - drag.startPoint.z) * drag.normalZ;
    const precision = event.shiftKey ? CONFIG.thickness.precisionMultiplier : 1;
    let thickness = drag.startThickness + alongNormal * drag.direction * 2 * precision;
    thickness = clamp(thickness, CONFIG.thickness.minimum, CONFIG.thickness.maximum);
    if (event.ctrlKey) {
      thickness = Math.round(thickness / CONFIG.thickness.snapStep) * CONFIG.thickness.snapStep;
      thickness = clamp(thickness, CONFIG.thickness.minimum, CONFIG.thickness.maximum);
    }

    if (Math.abs(thickness - drag.startThickness) <= EPSILON) {
      this.restoreDirectDraft(drag);
      return;
    }
    drag.candidate = {
      ...drag.before,
      dimensions: { ...drag.before.dimensions, thickness },
    };
    this.controller.constructionView?.setDraft(drag.candidate, {
      constructionId: drag.constructionId,
      valid: true,
      anchorId: drag.anchorId,
    });
    this.directView.setRecord(drag.candidate, drag.arcTable, drag.anchorId);
  };

  const finishDirectDrag = prototype.finishDirectDrag;
  prototype.finishDirectDrag = function finishThicknessDrag(event, { commit }) {
    const drag = this.directDrag;
    if (!drag || drag.kind !== 'thickness') {
      return finishDirectDrag.call(this, event, { commit });
    }
    if (event.pointerId !== drag.pointerId) return;
    this.consumeDirectEvent(event);
    if (this.canvas?.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.directDrag = null;
    this.controller.constructionView?.clearDraft();

    if (commit && drag.candidate) {
      const change = this.controller.runConstructionCommand({
        type: 'set_dimensions',
        constructionId: drag.constructionId,
        dimensions: { thickness: drag.candidate.dimensions.thickness },
      });
      if (change) {
        this.controller.setSelectedConstruction(drag.constructionId, drag.anchorId);
        this.onStatus?.(`Wall thickness ${drag.candidate.dimensions.thickness.toFixed(2)} m.`);
      }
    }
    this.syncDirectGizmo();
  };
}

installConstructionThicknessGizmo();
