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

export function installNaturalConstructionContextBridge(controller) {
  if (controller.naturalConstructionContextBridge) {
    return controller.naturalConstructionContextBridge;
  }
  const abort = new AbortController();

  window.addEventListener(OPEN_STYLE_EVENT, (event) => {
    const constructionId = controller.selectedConstructionId;
    if (!constructionId || !controller.constructionPalette) return;
    controller.constructionGizmo?.close();
    controller.constructionPalette.open(
      constructionId,
      palettePoint(controller, event.detail),
    );
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

  const integration = {
    dispose() {
      abort.abort();
      controller.naturalConstructionContextBridge = null;
    },
  };
  controller.naturalConstructionContextBridge = integration;
  return integration;
}
