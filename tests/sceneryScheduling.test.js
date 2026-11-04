import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedSurfaceView } from '../src/editor/stylized/StylizedSurfaceViewBase.js';
import { setUnderwaterBlend } from '../src/editor/water/underwaterState.js';
import { SCENERY_WORK_ORDER, SceneryWorkScheduler, createSceneryConsumers } from '../src/editor/stylized/SceneryWorkScheduler.js';
import { syncViewRebuildQueue } from '../src/editor/stylized/ViewRebuildQueue.js';

function fixture() {
  const calls=[];const record=name=>()=>calls.push(name);
  const surface=Object.assign(Object.create(StylizedSurfaceView.prototype),{
    enabled:true,beginFrame:record('collision'),syncSceneryQueue:syncViewRebuildQueue,
    terrainView:{floatingOrigin:{toCanonical:()=>({x:0,z:0}),getState:()=>({x:0,z:0})}},
    config:{rocks:{radius:1,falloff:1}},objectMap:{list:()=>[]},slots:[],detailViews:[],
    waterSlots:[{update:record('water')}],skyView:{update:record('sky')},
    waterObstacleUpdates:{schedule:record('water obstacle schedule'),flush:record('water obstacle work')},
    meadowGrass:{updateFrame:record('grass frame'),prepareFrame:record('grass work'),frameInputs:{},blades:{staleTiles:[{}]}},
    updateForestGroundTextures:record('ground'),prewarmOneDistantWaterSlot(){},
  });
  for(const name of ['rock','tree','bush']) {
    const property=name==='tree'?'pendingLodRebuild':'pendingRebuild';
    surface[`${name}View`]={update:record(name),getPlacements:()=>[],[property]:{key:name},applyPendingRebuild:record(`${name} work`)};
  }
  for(const name of ['rock','tree','bush','detail','grass','flower']) {
    surface[`${name}BuildQueue`]={size:0,flush:run=>run({key:name},()=>false),retain(){},enqueue(){}};
  }
  surface.grassBuildQueue.flush=()=>{};surface.flowerBuildQueue.flush=()=>{};
  surface.sceneryScheduler=new SceneryWorkScheduler();surface.sceneryConsumers=createSceneryConsumers(surface);
  return {surface,calls};
}

test('animation and layout run every frame before budgeted publications',()=>{
  const {surface,calls}=fixture();surface.update(1000,{position:{x:0,z:0}});
  assert.deepEqual(calls.slice(0,4),['collision','sky','grass frame','rock']);
  assert.equal(calls.filter(name=>name==='grass frame').length,1);
  assert.ok(calls.indexOf('grass work')>calls.indexOf('bush'));
  for(const name of ['rock work','tree work','bush work'])assert.ok(calls.indexOf(name)>calls.indexOf('grass frame'));
  assert.ok(calls.indexOf('water obstacle work')>calls.indexOf('water obstacle schedule'));
});
test('submerged suspension preserves collision/water updates without grass work',()=>{
  const {surface,calls}=fixture();try{setUnderwaterBlend(1);surface.update(1000,{position:{x:0,z:0}});
    assert.deepEqual(calls,['collision','sky','water']);}finally{setUnderwaterBlend(0);}
});
test('continuous demand progresses each live producer on one shared allowance',()=>{
  const {surface}=fixture();let remaining=0;const progress={meadow:0,rock:0,tree:0,bush:0};
  const consume=name=>{if(remaining>0){remaining=0;progress[name]++;}};
  surface.meadowGrass.prepareFrame=()=>consume('meadow');
  for(const name of ['rock','tree','bush'])surface[`${name}View`].applyPendingRebuild=()=>consume(name);
  for(let frame=0;frame<SCENERY_WORK_ORDER.length;frame++){remaining=.25;surface.sceneryScheduler.beginFrame(surface.sceneryConsumers,()=>remaining<=0);}
  for(const [name,count] of Object.entries(progress))assert.ok(count>=1,`${name} advanced`);
  assert.equal(Object.values(progress).reduce((sum,n)=>sum+n,0),SCENERY_WORK_ORDER.length);
});
