const unit=v=>Math.max(0,Math.min(1,v));
export function terrainSubstrateWeights({tileId,canopy=0,wetness=0,shoreline=0}) {
 // Desert bares sand; tundra and glacier (Azgaar 10, 11) bare thawed earth.
 const S=tileId===1?1:0,T=tileId===10||tileId===11?1:0,M=Math.max(unit(wetness),unit(shoreline)*.75);
 const L=unit(canopy)*(1-M)*(1-S)*(1-T);
 return {sand:S*(1-M),thaw:T*(1-M),litter:L,mud:M,mineral:Math.max(0,1-(S+T)*(1-M)-L-M)};
}
export function terrainSubstrateResponse(input,profiles) {
 const weights=terrainSubstrateWeights(input),W=unit(input.wetness??0),tint=[0,0,0];let roughness=0,alpha=0;
 for(const [key,w] of Object.entries(weights)) {
  const p=profiles[key];roughness+=w*(p.roughness+(p.wetRoughness-p.roughness)*W);alpha+=w*p.tintMix;
  for(let c=0;c<3;c++)tint[c]+=w*p.tintMix*p.linearColor[c];
 }
 return {weights,roughness,tint,alpha,applyColor(base,dirtWeight=1,path=0){
  const share=unit(dirtWeight)*(1-unit(path));return base.map((c,i)=>c*(1-share*alpha)+tint[i]*share);
 }};
}
