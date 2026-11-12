import { encodeLookTable, MAX_MEADOW_PALETTES } from './meadowPalettes.js';
import { MEADOW_SHAPE_COUNT } from './meadowGrassShapes.js';

export const meadowGrowthSignature = p => JSON.stringify([
  p.shortHeight,p.tallHeight,p.width,p.density,p.patchMeters,p.shape,
]);
/** Keep unchanged uniform slots stable when a live edit changes profile deduplication. */
export function reconcileMeadowGrowth(previous,next) {
  const slots=new Array(16),indices=new Map([[0,0]]),used=new Set([0]);
  slots[0]=next.profiles[0];
  for(let i=1;i<next.profiles.length;i++) {
    const key=meadowGrowthSignature(next.profiles[i]);
    const old=previous.profiles.findIndex((p,j)=>j>0&&!used.has(j)&&meadowGrowthSignature(p)===key);
    if(old>=0){indices.set(i,old);used.add(old);slots[old]=next.profiles[i];}
  }
  for(let i=1;i<next.profiles.length;i++)if(!indices.has(i)) {
    const free=slots.findIndex((p,j)=>j>0&&!p);
    if(free<0)throw new Error('Meadow growth update exceeds 16 uniform slots.');
    indices.set(i,free);slots[free]=next.profiles[i];
  }
  const profiles=Array.from({length:16},(_,i)=>slots[i]??next.profiles[0]);
  return {...next,profiles,table:Uint8Array.from(next.table,index=>indices.get(index))};
}
/** Page-local cache keys include only biomes present on that page. */
export function meadowPageGrowthKey(tiles,growth,looks) {
  if(!growth)return '';
  const present=new Uint8Array(256);for(const id of tiles)present[id]=1;
  const entries=[];
  for(let id=0;id<256;id++)if(present[id])entries.push(`${id}:${looks[id]}:${meadowGrowthSignature(growth.profiles[growth.table[id]])}`);
  return 'growth1:'+entries.join('|');
}
export function applyMeadowGrowth(field,next) {
  const previous=field.settings.growth,growth=reconcileMeadowGrowth(previous,next);
  const palette=Uint8Array.from(field.settings.shapeTable,code=>Math.floor(code/MEADOW_SHAPE_COUNT)%MAX_MEADOW_PALETTES);
  const looks=encodeLookTable(growth.shapes,palette,growth.table);
  field.settings.growth=growth;field.settings.shapeTable=looks;
  for(let i=0;i<16;i++) {
    const p=growth.profiles[i];
    field.uniforms.growth.dimensions.array[i].set(p.shortHeight,p.tallHeight,p.width,p.patchMeters);
    field.uniforms.growth.areaStyle.array[i]=p.areaStyle;
field.uniforms.growth.density.array[i].set(...meadowGrowthResponse(p));
  }
  field.uniforms.growth.maxHeight=growth.maxHeight;field.uniforms.growth.maxWidth=growth.maxWidth;
  field.ground.setGrowth(growth,looks);
}
import { meadowGrowthResponse } from './meadowGrassShapes.js';
