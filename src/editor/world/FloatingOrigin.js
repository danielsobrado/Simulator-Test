export class FloatingOrigin {
  constructor({ threshold, snapSize }) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error('Floating-origin threshold must be positive.');
    }
    if (!Number.isFinite(snapSize) || snapSize <= 0) {
      throw new Error('Floating-origin snap size must be positive.');
    }
    this.threshold = threshold;
    this.snapSize = snapSize;
    this.originX = 0;
    this.originZ = 0;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Floating-origin listener failed.', error);
      }
    }
  }

  toCanonical(renderX, renderZ) {
    return Object.freeze({
      x: renderX + this.originX,
      z: renderZ + this.originZ,
    });
  }

  toRender(worldX, worldZ) {
    return Object.freeze({
      x: worldX - this.originX,
      z: worldZ - this.originZ,
    });
  }

  update(renderFocus) {
    if (Math.abs(renderFocus.x) < this.threshold && Math.abs(renderFocus.z) < this.threshold) {
      return null;
    }
    const shiftX = Math.trunc(renderFocus.x / this.snapSize) * this.snapSize;
    const shiftZ = Math.trunc(renderFocus.z / this.snapSize) * this.snapSize;
    if (shiftX === 0 && shiftZ === 0) {
      return null;
    }
    this.originX += shiftX;
    this.originZ += shiftZ;
    const event = Object.freeze({
      shiftX,
      shiftZ,
      originX: this.originX,
      originZ: this.originZ,
    });
    this.notify(event);
    return event;
  }

  setOrigin(originX, originZ) {
    if (!Number.isFinite(originX) || !Number.isFinite(originZ)) {
      throw new Error('Floating-origin coordinates must be finite.');
    }
    const shiftX = originX - this.originX;
    const shiftZ = originZ - this.originZ;
    this.originX = originX;
    this.originZ = originZ;
    return Object.freeze({ shiftX, shiftZ, originX, originZ });
  }

  getState() {
    return Object.freeze({ x: this.originX, z: this.originZ });
  }
}
