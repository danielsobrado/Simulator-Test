/**
 * Capture-phase hotkeys that outrank the player controller.
 *
 * `PlayerController.onKeyDown` calls `stopImmediatePropagation` on every
 * non-Escape key while walking, so anything that needs a key in walk mode has to
 * be registered on the capture phase *before* the player controller is
 * constructed. The composition root does that; `getHandler` is re-read on every
 * key so the owning system can bind late.
 *
 * @param {() => ((event: KeyboardEvent) => boolean) | null | undefined} getHandler
 *   returns the current handler; returning `true` claims the event
 * @param {Window | EventTarget} [target]
 * @returns {() => void} detach
 */
export function attachCaptureHotkey(getHandler, target = window) {
  const onKeyDown = (event) => {
    if (getHandler()?.(event) === true) {
      event.stopImmediatePropagation();
    }
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
