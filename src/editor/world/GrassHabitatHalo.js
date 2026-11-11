import { floatToHalf,halfToFloat } from '../water/WaterField.js';
import { snowAtPoint } from '../materials/SnowAccumulation.js';
import { terrainBakeMacroSeed } from '../materials/TerrainBakeNoise.js';
import { grassHabitatEligible } from './GrassHabitatCoverage.js';
const unit = v => Math.max(0, Math.min(1, v));
const smooth = (a,b,v) => {const t=unit((v-a)/(b-a));return t*t*(3-2*t);};
/** Preparation only: worker and synchronous fallback share the same halo rules. */
export function prepareGrassHabitatHalo({halo,haloSize,searchRadius,chunkSize,heights,
  originX,originZ,maskConfig,sampleHeight=null,sampleWater=null,coreWater,snowCover=null}) {
  const tileSize = maskConfig.tileSize ?? maskConfig.snow?.tileSize ?? 2;
  const tileIds = new Set(maskConfig.grassTileIds);
  const snowSettings = maskConfig.snow?.classification ? maskConfig.snow : null;
  const seed = snowSettings ? terrainBakeMacroSeed(snowSettings.seedOffset,maskConfig.worldSeed) : 0;
  const eligibility = new Uint8Array(halo.length);
  const water = new Float32Array(halo.length);
  const snowed = new Uint8Array(halo.length);
  const hCache = new Map(), wCache = new Map();
  const heightAt = (x,z) => {
    const lx=x-originX,lz=z-originZ;
    if(heights && lx>=0 && lz>=0 && lx<=chunkSize && lz<=chunkSize)return Math.fround(heights[lz*(chunkSize+1)+lx]);
    const key=`${x}:${z}`;
    if(!hCache.has(key)) {
      if(!sampleHeight && snowSettings) throw new Error('Grass habitat snow halo requires height sampling.');
      hCache.set(key,Math.fround(sampleHeight?.(x,z) ?? 0));
    }
    return hCache.get(key);
  };
  const waterAt = (x,z) => {
    const key=`${x}:${z}`;
    if(!wCache.has(key))wCache.set(key,sampleWater?.(x,z) ?? null);
    return wCache.get(key);
  };
  for(let z=0;z<haloSize;z++)for(let x=0;x<haloSize;x++) {
    const i=z*haloSize+x, cx=originX+x-searchRadius,cz=originZ+z-searchRadius;
    const lx=x-searchRadius,lz=z-searchRadius,tileId=halo[i];
    let occupancy=tileId===maskConfig.waterTileId?1:0;
    if(coreWater&&lx>=0&&lz>=0&&lx<chunkSize&&lz<chunkSize)occupancy=Math.max(occupancy,coreWater(lx,lz));
    else if(sampleWater)for(let dz=0;dz<=1;dz++)for(let dx=0;dx<=1;dx++) {
      const w=waterAt(cx+dx,cz+dz);
      if(w)occupancy=Math.max(occupancy,unit(halfToFloat(floatToHalf(w.coverage)))*smooth(0,maskConfig.waterlineDepth??.35,Math.max(0,halfToFloat(floatToHalf(w.depth)))));
    }
    water[i]=occupancy;
    let snow=0;
    if(snowSettings && tileIds.has(tileId) && occupancy<1) {
      const a=heightAt(cx,cz),b=heightAt(cx+1,cz),c=heightAt(cx,cz+1),d=heightAt(cx+1,cz+1);
      const dx=(b+d-a-c)/(2*tileSize),dz=(c+d-a-b)/(2*tileSize);
      snow=snowAtPoint({height:(a+b+c+d)*.25,slope:Math.hypot(dx,dz),dx,dz,curvature:0,tileId,
        biomeCover:snowCover?.[i],
        worldX:(cx+.5)*tileSize,worldZ:-(cz+.5)*tileSize},snowSettings.classification,seed);
    }
    eligibility[i]=grassHabitatEligible({tileId,snow,water:occupancy},tileIds)?1:0;
    // Grass ground lost to a drift, not to a barren biome: the sward runs up to it.
    snowed[i]=!eligibility[i]&&occupancy<1&&tileIds.has(tileId)?1:0;
  }
  return {eligibility,water,snowed};
}
