import {float,max,oneMinus,vec3} from 'three/tsl';
import { resolveTerrainSubstrates } from './TerrainSubstrateConfig.js';
const defaults = resolveTerrainSubstrates();
export function createTerrainSubstrateNodes({tileId,canopy,wetness,shoreline,profiles=defaults}) {
 // Mirrors TerrainSubstrateMath.terrainSubstrateWeights.
 const W=wetness.clamp(0,1),S=tileId.equal(1).select(float(1),float(0));
 const T=tileId.equal(10).or(tileId.equal(11)).select(float(1),float(0));
 const M=max(W,shoreline.clamp(0,1).mul(.75)),L=canopy.clamp(0,1).mul(oneMinus(M)).mul(oneMinus(S)).mul(oneMinus(T));
 const weights={sand:S.mul(oneMinus(M)),thaw:T.mul(oneMinus(M)),litter:L,mud:M,
  mineral:max(0,oneMinus(S.add(T).mul(oneMinus(M)).add(L).add(M)))};
 let roughness=float(0),tint=vec3(0),alpha=float(0);
 for(const [key,w] of Object.entries(weights)) {
  const p=profiles[key];roughness=roughness.add(w.mul(float(p.roughness).add(W.mul(p.wetRoughness-p.roughness))));
  tint=tint.add(vec3(...p.linearColor).mul(w).mul(p.tintMix));alpha=alpha.add(w.mul(p.tintMix));
 }
 return {roughness,applyColor(base,dirtWeight,path){
  const share=dirtWeight.clamp(0,1).mul(oneMinus(path.clamp(0,1)));
  return base.mul(oneMinus(share.mul(alpha))).add(tint.mul(share));
 }};
}
