import test from 'node:test';import assert from 'node:assert/strict';
import {resolveTerrainSubstrates} from '../src/editor/materials/TerrainSubstrateConfig.js';
import {terrainSubstrateResponse} from '../src/editor/materials/TerrainSubstrateMath.js';
import {terrainMaterialRecipeFingerprint} from '../src/editor/materials/TerrainMaterialRecipe.js';
import {createTerrainMaterialBakeDescriptor,terrainMaterialBakeNeedsRefresh} from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';
const profiles=resolveTerrainSubstrates();
test('all biome substrate weights normalize and wet surfaces never get rougher',()=>{
 for(const tileId of [...Array(13).keys(),32])for(const canopy of [0,.5,1])for(const shoreline of [0,.5,1]){
  let previous=1;
  for(const wetness of [0,.5,1]){
   const r=terrainSubstrateResponse({tileId,canopy,shoreline,wetness},profiles);
   assert.ok(Math.abs(Object.values(r.weights).reduce((a,b)=>a+b,0)-1)<1e-6);
   assert.ok(r.roughness<=previous);previous=r.roughness;
   assert.deepEqual(r.applyColor([.2,.3,.4],1,1),[.2,.3,.4]);
  }
 }
});
test('dirt tint is excluded from full snow and painted paths across mixed families',()=>{
 const base=[.2,.3,.4];
 for(const tileId of [...Array(13).keys(),32])for(const canopy of [0,.5,1])for(const wetness of [0,.5,1])for(const shoreline of [0,.5,1]) {
  const r=terrainSubstrateResponse({tileId,canopy,wetness,shoreline},profiles);
  assert.deepEqual(r.applyColor(base,0,0),base);
  for(const dirt of [.25,.5,1])assert.deepEqual(r.applyColor(base,dirt,1),base);
  const half=r.applyColor(base,.5,0),full=r.applyColor(base,1,0);
  for(let c=0;c<3;c++)assert.ok(Math.abs(half[c]-(base[c]+full[c])*.5)<1e-12);
 }
});
test('material changes refresh derived cache identity without revising source terrain',()=>{
 const config={families:{substrates:profiles}},before=terrainMaterialRecipeFingerprint(config);
 const changed=structuredClone(config);changed.families.substrates.sand.tintMix=.17;
 const after=terrainMaterialRecipeFingerprint(changed);
 assert.notEqual(before,after);
 const inputs={chunkX:-2,chunkZ:4,quality:'balanced',revisions:{world:1,tile:2,height:3,water:4,canopy:5}};
 const a=createTerrainMaterialBakeDescriptor({...inputs,recipe:before}),b=createTerrainMaterialBakeDescriptor({...inputs,recipe:after});
 assert.ok(terrainMaterialBakeNeedsRefresh(a,b));assert.deepEqual(a.revisions,b.revisions);assert.equal(a.slotKey,b.slotKey);
 assert.equal(terrainMaterialRecipeFingerprint({b:1,a:2}),terrainMaterialRecipeFingerprint({a:2,b:1}));
});
test('pure sand, litter, mud and fallback mineral are selected explicitly',()=>{
 assert.equal(terrainSubstrateResponse({tileId:1},profiles).roughness,.93);
 assert.equal(terrainSubstrateResponse({tileId:6,canopy:1},profiles).roughness,.97);
 assert.equal(terrainSubstrateResponse({tileId:12,wetness:1},profiles).roughness,.43);
 assert.equal(terrainSubstrateResponse({tileId:32},profiles).roughness,.90);
 assert.throws(()=>resolveTerrainSubstrates({sand:{tintMix:2}}),/tintMix/);
});
test('snow country bares dark thawed earth, not the lowland dirt',()=>{
 for(const tileId of [10,11]){
  const r=terrainSubstrateResponse({tileId},profiles);
  assert.equal(r.weights.thaw,1);
  const bare=r.applyColor([.5,.4,.3],1,0);
  assert.ok(bare.every((c,i)=>c<[.5,.4,.3][i]*.4));
 }
 assert.equal(terrainSubstrateResponse({tileId:10,wetness:1},profiles).weights.mud,1);
});
