import {
  GAMEPLAY_OVERLAY,
  GAMEPLAY_OVERLAY_SHORTCUTS,
  isTypingTarget,
} from './gameplayOverlayConstants.js';

/**
 * Single authority for large gameplay overlays (inventory, world map, …).
 * Owns shortcut precedence so overlays do not depend on listener registration order.
 */
export class GameplayOverlayController {
  /**
   * @param {{
   *   target?: EventTarget,
   *   document?: Document,
   *   getPlayerController?: () => object | null,
   * }} [options]
   */
  constructor({
    target = globalThis,
    document: doc = globalThis.document,
    getPlayerController = () => null,
  } = {}) {
    this.target = target;
    this.document = doc;
    this.getPlayerController = getPlayerController;
    this.overlays = new Map();
    this.shortcutByCode = new Map([
      [GAMEPLAY_OVERLAY_SHORTCUTS.inventory, GAMEPLAY_OVERLAY.inventory],
      [GAMEPLAY_OVERLAY_SHORTCUTS.worldMap, GAMEPLAY_OVERLAY.worldMap],
    ]);
    this.activeOverlay = null;
    this.previousOverlay = null;
    this.restorePointerLock = false;
    this.listeners = new Set();

    this.boundHandlers = {
      keyDown: (event) => this.onKeyDown(event),
      keyUp: (event) => this.onKeyUp(event),
    };
    this.target?.addEventListener?.('keydown', this.boundHandlers.keyDown, true);
    this.target?.addEventListener?.('keyup', this.boundHandlers.keyUp, true);
  }

  /**
   * @param {string} id
   * @param {{
   *   onOpen?: () => void,
   *   onClose?: () => void,
   *   onEscape?: () => boolean,
   *   onKeyDown?: (event: KeyboardEvent) => boolean | void,
   *   onKeyUp?: (event: KeyboardEvent) => boolean | void,
   * }} handlers
   */
  registerOverlay(id, handlers = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Overlay id must be a non-empty string.');
    }
    this.overlays.set(id, handlers);
    return () => {
      if (this.activeOverlay === id) this.close(id);
      this.overlays.delete(id);
    };
  }

  getState() {
    return Object.freeze({
      activeOverlay: this.activeOverlay,
      previousOverlay: this.previousOverlay,
      restorePointerLock: this.restorePointerLock,
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  isOpen(id) {
    return this.activeOverlay === id;
  }

  isWorldInputBlocked() {
    return this.activeOverlay != null;
  }

  open(id) {
    if (!this.overlays.has(id)) {
      throw new Error(`Unknown gameplay overlay "${id}".`);
    }
    if (this.activeOverlay === id) return;

    const player = this.getPlayerController?.() ?? null;
    const openingFirst = this.activeOverlay == null;

    if (this.activeOverlay != null) {
      this.closeOverlayInternal(this.activeOverlay, { restorePointerLock: false });
    }

    if (openingFirst) {
      this.restorePointerLock = Boolean(player?.pointerLocked);
      if (this.restorePointerLock) {
        this.document?.exitPointerLock?.();
      }
      player?.setUiBlocked?.(true);
      player?.resetInput?.();
    }

    this.activeOverlay = id;
    this.overlays.get(id)?.onOpen?.();
    this.emit();
  }

  close(id) {
    if (id != null && this.activeOverlay !== id) return;
    if (this.activeOverlay == null) return;
    this.closeOverlayInternal(this.activeOverlay, { restorePointerLock: true });
    this.emit();
  }

  closeActive() {
    this.close(this.activeOverlay);
  }

  toggle(id) {
    if (this.activeOverlay === id) {
      this.close(id);
    } else {
      this.open(id);
    }
  }

  closeOverlayInternal(id, { restorePointerLock }) {
    this.overlays.get(id)?.onClose?.();
    this.previousOverlay = id;
    this.activeOverlay = null;

    if (restorePointerLock) {
      const player = this.getPlayerController?.() ?? null;
      player?.setUiBlocked?.(false);
      if (this.restorePointerLock) {
        player?.requestPointerLock?.();
      }
      this.restorePointerLock = false;
    }
  }

  onKeyDown(event) {
    if (isTypingTarget(event.target)) return;
    if (event.repeat) return;

    const overlayId = this.shortcutByCode.get(event.code);
    if (overlayId) {
      if (!this.overlays.has(overlayId)) return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      this.toggle(overlayId);
      return;
    }

    if (this.activeOverlay == null) return;

    if (event.code === 'Escape' || event.key === 'Escape') {
      const handlers = this.overlays.get(this.activeOverlay);
      const cancelledLocal = handlers?.onEscape?.() === true;
      if (!cancelledLocal) {
        this.closeActive();
      }
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }

    const handled = this.overlays.get(this.activeOverlay)?.onKeyDown?.(event);
    event.stopImmediatePropagation?.();
    if (handled === true) {
      event.preventDefault?.();
    }
  }

  onKeyUp(event) {
    if (this.activeOverlay == null) return;
    if (isTypingTarget(event.target)) return;
    this.overlays.get(this.activeOverlay)?.onKeyUp?.(event);
    event.stopImmediatePropagation?.();
  }

  dispose() {
    if (this.activeOverlay != null) {
      this.closeOverlayInternal(this.activeOverlay, { restorePointerLock: false });
      const player = this.getPlayerController?.() ?? null;
      player?.setUiBlocked?.(false);
      this.restorePointerLock = false;
    }
    this.target?.removeEventListener?.('keydown', this.boundHandlers.keyDown, true);
    this.target?.removeEventListener?.('keyup', this.boundHandlers.keyUp, true);
    this.overlays.clear();
    this.listeners.clear();
  }
}
