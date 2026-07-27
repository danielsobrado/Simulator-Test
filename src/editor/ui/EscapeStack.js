/**
 * The single owner of the Escape key.
 *
 * Escape used to have four independent handlers — `EditorController` and the
 * workshop material controller on the bubble phase, `ViewModeController` and
 * `PlayerController` on the capture phase — each guessing whether it should act.
 * Adding player-mode editing and a radial palette to that would not resolve.
 *
 * One capture-phase listener runs registered handlers highest priority first.
 * The first handler to return `true` consumes the event and stops propagation,
 * so Escape always backs out exactly one level.
 */

export const ESCAPE_PRIORITY = Object.freeze({
  modal: 100,
  palette: 90,
  inspector: 80,
  gesture: 70,
  selection: 60,
  playerPaused: 50,
  playerWalking: 40,
  spawnSelection: 30,
});

export class EscapeStack {
  constructor({ target = globalThis } = {}) {
    this.target = target;
    this.handlers = [];
    this.nextToken = 1;
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.target?.addEventListener?.('keydown', this.onKeyDown, true);
  }

  /**
   * @param handler Returns `true` when it consumed the Escape press.
   * @returns An unregister function.
   */
  register(priority, handler, { label = '' } = {}) {
    if (typeof handler !== 'function') throw new Error('An escape handler must be a function.');
    if (!Number.isFinite(priority)) throw new Error('An escape priority must be finite.');
    const token = this.nextToken;
    this.nextToken += 1;
    this.handlers.push({ token, priority, handler, label });
    // Descending priority; ties resolve by registration order so a later
    // registration at the same level does not silently jump the queue.
    this.handlers.sort((a, b) => b.priority - a.priority || a.token - b.token);
    return () => {
      const index = this.handlers.findIndex((entry) => entry.token === token);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  handleKeyDown(event) {
    if (event.key !== 'Escape' && event.code !== 'Escape') return;
    // Escape inside a text field belongs to the field.
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    for (const entry of [...this.handlers]) {
      if (entry.handler(event) === true) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
  }

  dispose() {
    this.target?.removeEventListener?.('keydown', this.onKeyDown, true);
    this.handlers = [];
  }
}
