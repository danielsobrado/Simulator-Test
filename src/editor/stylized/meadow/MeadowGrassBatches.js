import { meadowPageTileCapacity, MeadowBandBatch } from './MeadowBandBatch.js';

/** Keep tile assignments stable and bound the buffers affected by an update. */
class MeadowBandPages {
  constructor(options) {
    this.options = options;
    this.stride = Math.max(1, options.template.instanceCount);
    this.pageTileCapacity = meadowPageTileCapacity(this.stride);
    this.slots = new Map();
    this.present = new Set();
    this.pages = [];
    this.peers = [];
    this.addPage();
  }

  addPage() {
    const page = new MeadowBandBatch({ ...this.options,
      name: `${this.options.name}-${this.pages.length}` });
    page.members = [];
    page.memberCount = 0;
    this.pages.push(page);
    return page;
  }

  takeTilePageFrom(previous, tile) {
    if (!this.peers.includes(previous)) return;
    const page = previous.slots.get(tile);
    if (!page) return;
    previous.slots.delete(tile);
    this.takePageFrom(previous, page);
    this.slots.set(tile, page);
  }

  takePageFrom(previous, page) {
    previous.pages.splice(previous.pages.indexOf(page), 1);
    page.setTemplate(this.options.template);
    page.mesh.name = `${this.options.name}-${page.geometry.id}`;
    this.pages.push(page);
    return page;
  }

  availablePage() {
    const own = this.pages.find(page => page.memberCount < this.pageTileCapacity);
    if (own) return own;
    for (const peer of this.peers) {
      const empty = peer.pages.find(page => page.memberCount === 0);
      if (empty) return this.takePageFrom(peer, empty);
    }
    return this.addPage();
  }

  retireTiles(tiles) {
    this.present.clear();
    for (const tile of tiles) this.present.add(tile);
    for (const [tile, page] of this.slots) {
      if (this.present.has(tile)) continue;
      page.memberCount -= 1;
      this.slots.delete(tile);
    }
    // A wholly retired page costs no upload: hide it before another band can
    // reuse it, even when its future source publication must wait.
    for (const page of this.pages) if (page.memberCount === 0) page.update([]);
  }

  update(tiles, budget) {
    for (const page of this.pages) page.members.length = 0;
    for (const tile of tiles) {
      let page = this.slots.get(tile);
      if (!page) {
        page = this.availablePage();
        this.slots.set(tile, page);
        page.memberCount += 1;
      }
      page.members.push(tile);
    }
    let stems = 0;
    for (const page of this.pages) stems += page.update(page.members, budget);
    return stems;
  }

  get meshes() {
    return this.pages.map(page => page.mesh);
  }

  get slotCapacity() {
    return this.pages.reduce((sum, page) => sum + page.slotCapacity, 0);
  }

  setBoundsPadding(padding) {
    if (this.options.boundsPadding === padding) return;
    this.options.boundsPadding = padding;
    for (const page of this.pages) page.bounds?.setPadding(padding);
  }

  dispose() {
    for (const page of this.pages) page.dispose();
    this.pages.length = 0;
    this.slots.clear();
  }
}

/** The batches for every band of one template family. */
export class MeadowGrassBatches {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.scene
   * @param {Record<string, THREE.InstancedBufferGeometry>} options.templates band → template
   * @param {THREE.Material} options.material
   * @param {string} options.name
   * @param {number} [options.renderOrder]
   */
  constructor({ scene, templates, material, name, renderOrder = 0, boundsPadding = null, getDrawPreparation = () => null }) {
    this.batches = new Map();
    this.members = new Map();
    this.singleTileOwners = new Map();
    for (const [band, template] of Object.entries(templates)) {
      this.batches.set(band, new MeadowBandPages({ scene, template, material, name: `${name}-${band}`, renderOrder, boundsPadding, getDrawPreparation }));
      this.members.set(band, []);
    }
    for (const batch of this.batches.values()) {
      if (batch.pageTileCapacity !== 1) continue;
      batch.peers = [...this.batches.values()].filter(peer => peer !== batch
        && peer.pageTileCapacity === 1 && peer.stride === batch.stride
        && peer.options.template.userData.meadow.tileSize === batch.options.template.userData.meadow.tileSize);
    }
  }

  begin() {
    for (const list of this.members.values()) list.length = 0;
  }

  add(band, tile) {
    this.members.get(band)?.push(tile);
  }

  /** @returns {Record<string, number>} stems drawn per band */
  commit(budget = null) {
    // High/medium dense bands have equal populations and one tile per page.
    // Move ownership before either band retires its old members, retaining the
    // populated GPU attributes when only the blade template changes.
    this.singleTileOwners.clear();
    for (const batch of this.batches.values()) {
      if (batch.pageTileCapacity === 1) {
        for (const tile of batch.slots.keys()) this.singleTileOwners.set(tile, batch);
      }
    }
    for (const [band, batch] of this.batches) {
      if (batch.pageTileCapacity !== 1) continue;
      for (const tile of this.members.get(band)) {
        batch.takeTilePageFrom(this.singleTileOwners.get(tile), tile);
      }
    }
    this.singleTileOwners.clear();
    // Retire every band before allocating, so a teleport can reuse an empty
    // compatible page even when its previous band is later in the update order.
    for (const [band, batch] of this.batches) batch.retireTiles?.(this.members.get(band));
    const stems = {};
    for (const [band, batch] of this.batches) stems[band] = batch.update(this.members.get(band), budget);
    return stems;
  }

  rebase(x, z, budget) {
    for (const batch of this.batches.values()) for (const page of batch.pages) page.rebase(x, z, budget);
  }

  get pending() {
    let pending = 0;
    for (const batch of this.batches.values()) for (const page of batch.pages) pending += Number(Boolean(page.pending));
    return pending;
  }

  isPublished(tile) {
    const batch = this.batches.get(tile.builtBand), slot = batch?.slots.get(tile)?.slots.get(tile);
    return Boolean(slot && slot.source === (tile.prepared ?? tile.buildId)
      && slot.count === Math.min(tile.output.count, batch.stride));
  }

  publicationBytes(tile, band, output) {
    const batch = this.batches.get(band);
    const page = batch?.slots.get(tile);
    const slot = page?.slots.get(tile);
    // A shrinking tile also moves up to its lost stems from the page tail into its holes.
    return (output.count + Math.max(0, (slot?.count ?? 0) - output.count)) * 14 * 4;
  }

  get meshes() {
    return [...this.batches.values()].flatMap((batch) => batch.meshes);
  }

  setBoundsPadding(padding) {
    for (const batch of this.batches.values()) batch.setBoundsPadding?.(padding);
  }

  dispose() {
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.members.clear();
    this.singleTileOwners.clear();
  }
}
