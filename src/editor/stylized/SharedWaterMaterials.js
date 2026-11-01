import { DoubleSide } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createStylizedWaterMaterial } from './StylizedWaterMaterial.js';
import { bilinearLoad, perObjectTexture } from '../materials/TerrainSlotBindings.js';

export const WATER_SLOT_OPTIONS = 'waterSlotOptions';

/** One graph for each water variant, with exact per-slot inputs at draw time. */
export class SharedWaterMaterials {
  constructor(reflections = null) {
    this.reflections = reflections;
    this.materials = new Map();
    this.bindings = null;
    this.disposed = false;
  }

  get(options, enableRefraction) {
    if (this.materials.has(enableRefraction)) return this.materials.get(enableRefraction);
    if (!this.bindings) {
      const read = object => object?.userData?.[WATER_SLOT_OPTIONS] ?? options;
      const bindings = { ...options };
      for (const name of ['waterSurfaceOrigin', 'chunkCenter', 'time', 'rippleOrigin', 'patternOrigin']) {
        const value = options[name]?.value;
        if (value === undefined) continue;
        bindings[name] = uniform(value.clone?.() ?? value)
          .onObjectUpdate(({ object }) => read(object)[name].value);
      }
      bindings.seaPhaseOrigin = options.seaPhaseOrigin?.map((node, index) => uniform(node.value)
        .onObjectUpdate(({ object }) => read(object).seaPhaseOrigin[index].value));
      bindings.surfacePatterns = options.surfacePatterns.perObject(object => read(object).surfacePatterns);
      bindings.sampleTexture = (name, template, uv) => perObjectTexture(template, uv, object => read(object)[name]);
      bindings.loadTexture = (name, template, uv) => bilinearLoad(template, uv, object => read(object)[name]);
      this.bindings = bindings;
    }
    const material = createStylizedWaterMaterial({ ...this.bindings, enableRefraction, reflections: this.reflections });
    material.side = DoubleSide;
    this.materials.set(enableRefraction, material);
    return material;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
