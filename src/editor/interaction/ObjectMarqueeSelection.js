import * as THREE from 'three/webgpu';
import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

const PROJECTED = new THREE.Vector3();
const MIN_DRAG_PX = NATURAL_EDITOR_UI_CONFIG.selection.dragThresholdPx;

function clientRect(startX, startY, endX, endY) {
  return {
    left: Math.min(startX, endX),
    right: Math.max(startX, endX),
    top: Math.min(startY, endY),
    bottom: Math.max(startY, endY),
  };
}

function queryCandidates(controller, start, end) {
  const startCell = controller.terrainView.pickCell(
    start.x,
    start.y,
    controller.activeCamera,
  );
  const endCell = controller.terrainView.pickCell(
    end.x,
    end.y,
    controller.activeCamera,
  );
  if (!startCell || !endCell || typeof controller.objectMap.queryBounds !== 'function') {
    return controller.objectMap.list();
  }
  return controller.objectMap.queryBounds({
    minX: Math.min(startCell.x, endCell.x),
    maxX: Math.max(startCell.x, endCell.x),
    minZ: Math.min(startCell.z, endCell.z),
    maxZ: Math.max(startCell.z, endCell.z),
  });
}

function objectClientPoint(controller, object, canvasBounds) {
  try {
    const placement = controller.objectView.resolvePlacement(object);
    const center = controller.objectView.placementResolver.renderCenter(placement.bounds);
    PROJECTED.set(
      center.x,
      placement.surface.baseHeight + controller.tileMap.tileSize * 0.5,
      center.z,
    ).project(controller.activeCamera);
    if (!Number.isFinite(PROJECTED.x) || !Number.isFinite(PROJECTED.y)) return null;
    return {
      x: canvasBounds.left + (PROJECTED.x + 1) * 0.5 * canvasBounds.width,
      y: canvasBounds.top + (1 - PROJECTED.y) * 0.5 * canvasBounds.height,
    };
  } catch {
    return null;
  }
}

export class ObjectMarqueeSelection {
  constructor(controller, selection) {
    this.controller = controller;
    this.selection = selection;
    this.drag = null;
    this.element = document.createElement('div');
    this.element.className = 'natural-selection-marquee';
    this.element.hidden = true;
    document.body.append(this.element);
  }

  begin(event) {
    if (this.drag || event.button !== 0) return false;
    this.drag = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      active: false,
    };
    this.controller.canvas?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }

  update(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    drag.current = { x: event.clientX, y: event.clientY };
    drag.active = drag.active || Math.hypot(
      drag.current.x - drag.start.x,
      drag.current.y - drag.start.y,
    ) >= MIN_DRAG_PX;
    if (drag.active) this.render(drag);
    event.preventDefault();
    return true;
  }

  render(drag) {
    const rect = clientRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y);
    this.element.hidden = false;
    this.element.style.left = `${rect.left}px`;
    this.element.style.top = `${rect.top}px`;
    this.element.style.width = `${rect.right - rect.left}px`;
    this.element.style.height = `${rect.bottom - rect.top}px`;
  }

  finish(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (this.controller.canvas?.hasPointerCapture?.(event.pointerId)) {
      this.controller.canvas.releasePointerCapture(event.pointerId);
    }
    this.drag = null;
    this.element.hidden = true;
    if (event.type === 'pointercancel' || !drag.active) return true;

    const rect = clientRect(drag.start.x, drag.start.y, event.clientX, event.clientY);
    const canvasBounds = this.controller.canvas.getBoundingClientRect();
    const ids = [];
    for (const object of queryCandidates(this.controller, drag.start, {
      x: event.clientX,
      y: event.clientY,
    })) {
      const point = objectClientPoint(this.controller, object, canvasBounds);
      if (!point) continue;
      if (
        point.x >= rect.left
        && point.x <= rect.right
        && point.y >= rect.top
        && point.y <= rect.bottom
      ) ids.push(object.id);
    }
    this.selection.addMany(ids);
    event.preventDefault();
    return true;
  }

  cancel() {
    const drag = this.drag;
    if (drag && this.controller.canvas?.hasPointerCapture?.(drag.pointerId)) {
      this.controller.canvas.releasePointerCapture(drag.pointerId);
    }
    this.drag = null;
    this.element.hidden = true;
  }

  dispose() {
    this.cancel();
    this.element.remove();
  }
}
