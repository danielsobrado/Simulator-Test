import { MEADOW_CARD_HEIGHT_CONTRAST, MEADOW_SHORT_FLOOR, MEADOW_TALL_RAMP, MEADOW_TALL_TUFT_RELIEF, MEADOW_TUFT_DEFAULTS, MEADOW_TUFT_FIELD } from './meadowTuftField.js';
export { meadowCoverageRoll, acceptsMeadowHabitat } from './meadowHabitat.js';
const unit=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,v)=>{const t=unit((v-a)/(b-a));return t*t*(3-2*t);};
/** CPU twin of the existing meadow gradient noise; coordinates are pre-scaled. */
export function meadowNoiseNumber(x,z) {
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  const fade=t=>t*t*(3-2*t);
  const gradient=(dx,dz)=>{
    const s=Math.sin((ix+dx)*.1+(iz+dz)*.7)*43758.5453;
    const angle=(s-Math.floor(s))*Math.PI*2;
    return Math.cos(angle)*(fx-dx)+Math.sin(angle)*(fz-dz);
  };
  const north=gradient(0,0)+(gradient(1,0)-gradient(0,0))*fade(fx);
  const south=gradient(0,1)+(gradient(1,1)-gradient(0,1))*fade(fx);
  return north+(south-north)*fade(fz)+.5;
}
/** CPU twin of meadowTuftNodes' occupancy: 0 between plants, 1 in a tuft's core. */
export function meadowTuftOccupancy(x,z) {
  const f=MEADOW_TUFT_FIELD;
  const core=meadowNoiseNumber(x/f.coreMeters+f.coreOffset[0],z/f.coreMeters+f.coreOffset[1]);
  const cluster=meadowNoiseNumber(x/f.clusterMeters+f.clusterOffset[0],z/f.clusterMeters+f.clusterOffset[1]);
  return smooth(f.low,f.high,core*f.coreWeight+cluster*(1-f.coreWeight));
}
/** Share of the envelope from patch noise and tuft occupancy (meadowGrowthNodes, in JS). */
export function meadowGrowthShare(patchNoise,occupancy,tuftHeight=MEADOW_TUFT_DEFAULTS.height) {
  const ramp=smooth(MEADOW_TALL_RAMP[0],MEADOW_TALL_RAMP[1],unit(patchNoise)),weight=tuftHeight*(1-MEADOW_TALL_TUFT_RELIEF*ramp);
  return unit(ramp*(1-weight)+occupancy*weight);
}
export function meadowGrowthHeight(profile,x,z,cards=false,tuftHeight=MEADOW_TUFT_DEFAULTS.height) {
  const share=meadowGrowthShare(meadowNoiseNumber(x/profile.patchMeters,z/profile.patchMeters),meadowTuftOccupancy(x,z),tuftHeight);
  const tall=cards?.5+(share-.5)*MEADOW_CARD_HEIGHT_CONTRAST:share;
  const short=profile.shortHeight*MEADOW_SHORT_FLOOR;
  return (short+(profile.tallHeight-short)*tall)*(cards?1.125:1);
}
