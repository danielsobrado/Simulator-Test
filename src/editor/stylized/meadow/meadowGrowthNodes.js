import { mix,smoothstep } from 'three/tsl';
import { meadowNoise } from './meadowNoise.js';
import { meadowStandNodes } from './meadowStandNodes.js';
import { MEADOW_CARD_HEIGHT_CONTRAST, MEADOW_SHORT_FLOOR, MEADOW_TALL_RAMP, MEADOW_TALL_TUFT_RELIEF } from './meadowTuftField.js';
import { meadowTuftNodes } from './meadowTuftNodes.js';
/** Stand height from the profile's patch noise and the tuft field (CPU twin: meadowGrowthHeight). */
export function meadowGrowthNodes(uniforms,instance,cards=false) {
  const dimensions=uniforms.growth.dimensions.element(instance.growth.toInt());
  const noise=meadowNoise(instance.canonical.div(dimensions.w)).clamp(0,1);
  const tuft=meadowTuftNodes(instance.canonical);
  const ramp=smoothstep(MEADOW_TALL_RAMP[0],MEADOW_TALL_RAMP[1],noise).toVar();
  const weight=uniforms.tufts.height.mul(ramp.mul(-MEADOW_TALL_TUFT_RELIEF).add(1));
  const stemShare=mix(ramp,tuft.occupancy,weight).clamp(0,1);
  const share=cards?stemShare.sub(.5).mul(MEADOW_CARD_HEIGHT_CONTRAST).add(.5):stemShare;
  const response=uniforms.growth.density.element(instance.growth.toInt());
  const stand=cards?1.125:meadowStandNodes(instance.canonical,instance.rank).height;
  return {height:mix(dimensions.x.mul(MEADOW_SHORT_FLOOR),dimensions.y,share).mul(stand),
    tallHeight:dimensions.y,tuft,
    width:dimensions.z,density:response.x,wind:response.y,rest:response.z,curve:response.w};
}
