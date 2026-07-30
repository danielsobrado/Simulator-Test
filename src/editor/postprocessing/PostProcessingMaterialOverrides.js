import {
  mrt,
  normalView,
  output,
  packNormalToRGB,
  vec2,
} from 'three/tsl';

const REACTIVE_OBJECT_PATTERN = /(water|grass|flower|foliage|tree|bush|weather|particle|spell|fire)/i;
const WATER_OBJECT_PATTERN = /water/i;

export class PostProcessingMaterialOverrides {
  constructor(scene) {
    this.scene = scene;
    this.entries = [];
  }

  apply() {
    const seen = new Set();
    const waterMrt = mrt({
      output,
      normal: packNormalToRGB(normalView),
      velocity: vec2(2),
      metalrough: vec2(1, 0.07),
    });
    const reactiveMrt = mrt({
      output,
      normal: packNormalToRGB(normalView),
      velocity: vec2(2),
      metalrough: vec2(0, 1),
    });

    this.scene.traverse((object) => {
      if (!object.material || !REACTIVE_OBJECT_PATTERN.test(object.name ?? '')) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.isNodeMaterial || seen.has(material)) continue;
        seen.add(material);
        this.entries.push([material, material.mrtNode ?? null]);
        material.mrtNode = WATER_OBJECT_PATTERN.test(object.name ?? '') ? waterMrt : reactiveMrt;
        material.needsUpdate = true;
      }
    });
  }

  restore() {
    for (const [material, mrtNode] of this.entries) {
      material.mrtNode = mrtNode;
      material.needsUpdate = true;
    }
    this.entries.length = 0;
  }
}
