import { EditorController } from '../EditorController.js';

const PATCH_MARK = Symbol.for('drusniel.natural-construction-context');
const OPEN_STYLE_EVENT = 'drusniel:natural-construction-style';
const OPEN_DETAILS_EVENT = 'drusniel:natural-construction-details';

function palettePoint(controller, detail) {
  if (Number.isFinite(detail?.clientX) && Number.isFinite(detail?.clientY)) {
    return { clientX: detail.clientX, clientY: detail.clientY };
  }
  const bounds = controller.canvas?.getBoundingClientRect?.();
  return {
    clientX: bounds ? bounds.left + bounds.width / 2 : innerWidth / 2,
    clientY: bounds ? bounds.top + bounds.height / 2 : innerHeight / 2,
  };
}

function ensureContextBridge(controller) {
  if (controller.naturalConstructionContextAbort) return;
  const abort = new AbortController();
  controller.naturalConstructionContextAbort = abort;

  window.addEventListener(OPEN_STYLE_EVENT, (event) => {
    const constructionId = controller.selectedConstructionId;
    if (!constructionId || !controller.constructionPalette) return;
    controller.constructionGizmo?.close();
    controller.constructionPalette.open(constructionId, palettePoint(controller, event.detail));
    controller.emitState();
  }, { signal: abort.signal });

  window.addEventListener(OPEN_DETAILS_EVENT, () => {
    const constructionId = controller.selectedConstructionId;
    if (!constructionId || !controller.constructionPalette) return;
    controller.constructionPalette.close();
    controller.constructionGizmo?.close();
    controller.constructionPalette.openInspector(constructionId);
    controller.emitState();
  }, { signal: abort.signal });
}

function installBridge() {
  const prototype = EditorController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const setSelectedConstruction = prototype.setSelectedConstruction;
  prototype.setSelectedConstruction = function naturalSetSelectedConstruction(...args) {
    ensureContextBridge(this);
    return setSelectedConstruction.apply(this, args);
  };

  if (typeof prototype.dispose === 'function') {
    const dispose = prototype.dispose;
    prototype.dispose = function naturalDispose(...args) {
      this.naturalConstructionContextAbort?.abort();
      this.naturalConstructionContextAbort = null;
      return dispose.apply(this, args);
    };
  }
}

installBridge();
