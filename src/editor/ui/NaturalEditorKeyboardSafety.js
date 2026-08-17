import { EditorController } from '../EditorController.js';

const PATCH_MARK = Symbol.for('drusniel.natural-editor-keyboard-safety');

function isTextControl(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true;
}

function installKeyboardSafety() {
  const prototype = EditorController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const keyDown = prototype.onKeyDown;
  prototype.onKeyDown = function naturalSafeKeyDown(event) {
    if (isTextControl(event.target)) return;
    return keyDown.call(this, event);
  };
}

installKeyboardSafety();
