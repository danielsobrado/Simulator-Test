const HOVER_EVENT = 'drusniel:natural-editor-hover';

export function installNaturalEditorHoverBridge(controller) {
  if (controller.naturalEditorHoverBridge) return controller.naturalEditorHoverBridge;
  const emitHover = controller.emitHover.bind(controller);
  let lastTileId = null;

  controller.emitHover = (cell) => {
    const result = emitHover(cell);
    const tileId = cell ? controller.tileMap.get(cell.x, cell.z) : null;
    if (tileId === lastTileId) return result;
    lastTileId = tileId;
    const tile = tileId == null
      ? null
      : controller.tileMap.getTileDefinition?.(tileId) ?? null;
    window.dispatchEvent(new CustomEvent(HOVER_EVENT, {
      detail: tile ? Object.freeze({
        tileId,
        tileKey: tile.key,
        terrainClass: tile.terrainClass,
      }) : null,
    }));
    return result;
  };

  const integration = {
    dispose() {
      controller.naturalEditorHoverBridge = null;
    },
  };
  controller.naturalEditorHoverBridge = integration;
  return integration;
}
