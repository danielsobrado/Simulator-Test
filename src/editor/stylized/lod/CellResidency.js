/**
 * Which grid cells around the camera a view keeps resolved. Resolving asks the
 * world, so cells are worked off a few a frame and kept until they leave reach.
 * A cell's value is whatever the view's resolver returns; null means empty.
 */
export const CELL_PENDING = Symbol('cell-pending');

export class CellResidency {
  constructor({ cellMeters, reachCells, cellsPerFrame }) {
    Object.assign(this, { cellMeters, reachCells, cellsPerFrame });
    this.cells = new Map();
    this.pending = [];
    this.focusKey = null;
    this.dirty = false;
  }

  refocus(cameraX, cameraZ) {
    const focusX = Math.floor(cameraX / this.cellMeters);
    const focusZ = Math.floor(cameraZ / this.cellMeters);
    const key = `${focusX}:${focusZ}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    const wanted = new Set();
    this.pending.length = 0;
    for (let x = focusX - this.reachCells; x <= focusX + this.reachCells; x += 1) {
      for (let z = focusZ - this.reachCells; z <= focusZ + this.reachCells; z += 1) {
        const cell = `${x}:${z}`;
        wanted.add(cell);
        if (!this.cells.has(cell)) this.pending.push([x, z, cell]);
      }
    }
    for (const [cell, value] of this.cells) {
      if (wanted.has(cell)) continue;
      if (value) this.dirty = true;
      this.cells.delete(cell);
    }
  }

  /**
   * @param {(cellX: number, cellZ: number) => object|null} resolve
   * @returns {boolean} true once settled with a change the view should write
   */
  step(resolve, shouldYield = () => false) {
    const deferred = [];
    for (let i = 0; i < this.cellsPerFrame && this.pending.length; i += 1) {
      if (shouldYield()) break;
      const [x, z, cell] = this.pending.pop();
      const value = resolve(x, z);
      if (value === CELL_PENDING) { deferred.push([x, z, cell]); continue; }
      this.cells.set(cell, value);
      if (value) this.dirty = true;
    }
    this.pending.push(...deferred);
    if (!this.dirty || this.pending.length) return false;
    this.dirty = false;
    return true;
  }

  values() {
    return [...this.cells.values()].filter(Boolean);
  }
}
