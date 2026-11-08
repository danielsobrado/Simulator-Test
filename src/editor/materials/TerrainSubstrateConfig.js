export const TERRAIN_SUBSTRATES=Object.freeze({
 sand:Object.freeze({roughness:.93,wetRoughness:.78,color:'#b8a27c',tintMix:.18}),
 mineral:Object.freeze({roughness:.90,wetRoughness:.64,color:'#8a8170',tintMix:.10}),
 litter:Object.freeze({roughness:.97,wetRoughness:.72,color:'#63513d',tintMix:.22}),
 mud:Object.freeze({roughness:.87,wetRoughness:.43,color:'#555747',tintMix:.22}),
 // Snow country's bare ground: dark, damp earth between the drifts, not the lowland's tan dirt.
 thaw:Object.freeze({roughness:.84,wetRoughness:.5,color:'#3a332c',tintMix:.82}),
});
export function resolveTerrainSubstrates(source={}) {
 for(const key of Object.keys(source))if(!(key in TERRAIN_SUBSTRATES))throw new Error(`Invalid families.substrates.${key}`);
 return Object.freeze(Object.fromEntries(Object.entries(TERRAIN_SUBSTRATES).map(([key,d])=>{
  const p={...d,...source[key]};
  for(const field of ['roughness','wetRoughness','tintMix'])if(!Number.isFinite(p[field])||p[field]<0||p[field]>1)throw new Error(`Invalid families.substrates.${key}.${field}`);
  if(p.wetRoughness>p.roughness||!/^#[0-9a-f]{6}$/i.test(p.color))throw new Error(`Invalid families.substrates.${key}`);
  const linearColor=[1,3,5].map(i=>{const c=parseInt(p.color.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
  return [key,Object.freeze({...p,linearColor:Object.freeze(linearColor)})];
 })));
}
