import { EditorController } from '../EditorController.js';
import { TerrainAwareEditorController } from '../TerrainAwareEditorController.js';

const PATCH_MARK = Symbol.for('drusniel.natural-editor-hover-bridge');
const HOVER_EVENT = 'drusniel:natural-editor-hover';

function patchHoverEmitter(prototype) {
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_MARK)) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const emitHover = prototype.emitHover;
  if (typeof emitHover !== 'function') return;
  prototype.emitHover = function naturalEmitHover(cell) {
    const result = emitHover.call(this, cell);
    const tileId = cell ? this.tileMap.get(cell.x, cell.z) : null;
    if (tileId === this.naturalLastContextTileId) return result;
    this.naturalLastContextTileId = tileId;
    const tile = tileId == null ? null : this.tileMap.getTileDefinition?.(tileId) ?? null;
    window.dispatchEvent(new CustomEvent(HOVER_EVENT, {
      detail: tile ? Object.freeze({ tileId, tileKey: tile.key, terrainClass: tile.terrainClass }) : null,
    }));
    return result;
  };
}

patchHoverEmitter(EditorController.prototype);
patchHoverEmitter(TerrainAwareEditorController.prototype);
