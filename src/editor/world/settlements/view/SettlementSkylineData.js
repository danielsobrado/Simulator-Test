import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { PLASTER_PALETTES, ROOF_PALETTES, STONE_PALETTES } from '../../../workshop/WorkshopPalettes.js';
import { finishIndexFor } from '../SettlementBuildingCatalog.js';
import { settlementSkylineArrays } from './SettlementSkylineGeometry.js';

const linear = ([red, green, blue]) => [red / 255, green / 255, blue / 255];

export function skylineColors(style) {
  // Each town's own stone and roof, seen from afar: a skyline is how two towns are told apart.
  const stone = linear((STONE_PALETTES[style.style] ?? STONE_PALETTES.granite).base);
  const roof = linear((ROOF_PALETTES[style.topStyle] ?? ROOF_PALETTES.slate).ramp[0]).map((channel) => channel * 0.76);
  return {
    stone,
    roof,
    walls: (building) => {
      const finish = style.finishes[finishIndexFor(building.kind, building.variant) % style.finishes.length];
      return finish === 'masonry'
        ? stone
        : linear(PLASTER_PALETTES[finish].base).map((channel) => channel * 0.84);
    },
  };
}

/** Complete massing, normals and bounds are derived off the render thread. */
export function prepareSettlementSkyline(plan) {
  const arrays = settlementSkylineArrays(plan, skylineColors(plan.profile.style));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  geometry.setIndex(new BufferAttribute(arrays.indices, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const result = { ...arrays, normals: geometry.getAttribute('normal').array,
    sphere: { center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius } };
  geometry.dispose();
  return result;
}
