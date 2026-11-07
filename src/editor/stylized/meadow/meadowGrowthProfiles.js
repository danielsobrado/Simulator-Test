import { meadowShapeId } from './meadowGrassShapes.js';
export const MAX_MEADOW_GROWTH_PROFILES = 16;
const row = (shortHeight,tallHeight,width,density,patchMeters,shape='slender',areaStyle=1) =>
  Object.freeze({shortHeight,tallHeight,width,density,patchMeters,shape,areaStyle});
export const MEADOW_GROWTH_DEFAULTS = Object.freeze({
  0:row(0,0,0,0,12),1:row(0,0,0,0,12),2:row(0,0,0,0,12),
  3:row(.25,.85,.050,.62,8),4:row(.24,.82,.045,.92,17),
  5:row(.16,.50,.060,.85,11,'broadleaf',.6),6:row(.16,.44,.042,.85,10,'slender',.85),
  7:row(.14,.48,.065,.45,12,'broadleaf',.25),8:row(.18,.52,.062,.78,10,'broadleaf',.3),
  9:row(.13,.34,.050,.80,12,'slender',.7),10:row(.06,.16,.028,.28,7,'slender',.8),
  11:row(0,0,0,0,12),12:row(.14,.60,.045,.50,5,'reed',.2),
});
function validate(source,path) {
  const p={...source};
  for(const key of ['shortHeight','tallHeight','width','density','patchMeters']) {
    if(!Number.isFinite(p[key]) || p[key]<0)throw new Error(`Invalid editor configuration: ${path}.${key} must be finite and nonnegative.`);
  }
  if(p.tallHeight<p.shortHeight)throw new Error(`Invalid editor configuration: ${path}.tallHeight must be at least shortHeight.`);
  if(!(p.areaStyle>=0&&p.areaStyle<=1))throw new Error(`Invalid editor configuration: ${path}.areaStyle must be in [0,1].`);
  if(p.density>1)throw new Error(`Invalid editor configuration: ${path}.density must be in [0,1].`);
  if(p.density>0 && p.width<=0)throw new Error(`Invalid editor configuration: ${path}.width must be positive for nonzero density.`);
  if(p.patchMeters<2||p.patchMeters>64)throw new Error(`Invalid editor configuration: ${path}.patchMeters must be in [2,64].`);
  if(!['slender','reed','broadleaf'].includes(p.shape))throw new Error(`Invalid editor configuration: ${path}.shape is unknown.`);
  return Object.freeze(p);
}
/** Index zero is grassland fallback. Exact records deduplicate in ascending ID order. */
export function resolveMeadowGrowth(source={},path='stylizedSurface.grass.meadow.growth') {
  const byId={...MEADOW_GROWTH_DEFAULTS};
  for(const [key,value] of Object.entries(source?.byTileId??{})) {
    const id=Number(key);
    if(!Number.isInteger(id)||id<0||id>255)throw new Error(`Invalid editor configuration: ${path}.byTileId.${key} is not a terrain ID.`);
    byId[id]=validate({...(MEADOW_GROWTH_DEFAULTS[id]??MEADOW_GROWTH_DEFAULTS[4]),...value},`${path}.byTileId.${key}`);
  }
  const profiles=[validate(byId[4],`${path}.byTileId.4`)],table=new Uint8Array(256),shapes=new Uint8Array(256);
  const signature=p=>JSON.stringify([p.shortHeight,p.tallHeight,p.width,p.density,p.patchMeters,p.shape,p.areaStyle]);
  const indices=new Map([[signature(profiles[0]),0]]);
  shapes.fill(meadowShapeId(profiles[0].shape));
  for(const id of Object.keys(byId).map(Number).sort((a,b)=>a-b)) {
    const p=validate(byId[id],`${path}.byTileId.${id}`),key=signature(p);
    if(!indices.has(key)) {
      if(profiles.length===MAX_MEADOW_GROWTH_PROFILES)throw new Error(`Invalid editor configuration: ${path} exceeds ${MAX_MEADOW_GROWTH_PROFILES} profiles.`);
      indices.set(key,profiles.length);profiles.push(p);
    }
    table[id]=indices.get(key);shapes[id]=meadowShapeId(p.shape);
  }
  return Object.freeze({profiles:Object.freeze(profiles),table,shapes,
    revision:profiles.map(signature).join('|')+':'+Array.from(table).join(','),
    maxHeight:Math.max(...profiles.map(p=>p.tallHeight)),maxWidth:Math.max(...profiles.map(p=>p.width))});
}
