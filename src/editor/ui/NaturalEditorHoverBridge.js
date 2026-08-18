const HOVER_EVENT = 'drusniel:natural-editor-hover';

export function installNaturalEditorHoverBridge(controller) {
  if (controller.naturalEditorHoverBridge) return controller.naturalEditorHoverBridge;
  const originalEmitHover = controller.emitHover;
  let lastTileId = null;

  const bridgedEmitHover = (cell) => {
    const result = originalEmitHover.call(controller, cell);
    const tileId = cell ? controller.tileMap.get(cell.x, cell.z) : null;
    if (tileId === lastTileId) return result;
    lastTileId = tileId;
    const tile = tileId == null
      ? null
      : controller.tileMap.getTileDefinition?.(tileId) ?? null;
    globalThis.window?.dispatchEvent?.(new CustomEvent(HOVER_EVENT, {
      detail: tile ? Object.freeze({
        tileId,
        tileKey: tile.key,
        terrainClass: tile.terrainClass,
      }) : null,
    }));
    return result;
  };

  controller.emitHover = bridgedEmitHover;

  const integration = {
    dispose() {
      if (controller.emitHover === bridgedEmitHover) controller.emitHover = originalEmitHover;
      controller.naturalEditorHoverBridge = null;
    },
  };
  controller.naturalEditorHoverBridge = integration;
  return integration;
}
