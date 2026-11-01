import * as THREE from 'three/webgpu';
import { color, mix, positionWorld, texture, uniform, vec2 } from 'three/tsl';
import { loadEditorConfig } from '/src/config/loadEditorConfig.js';
import { GrassTuning } from '/src/editor/stylized/GrassTuning.js';
import { MeadowGrassField } from '/src/editor/stylized/meadow/MeadowGrassField.js';
import { resolveMeadowGrassConfig } from '/src/editor/stylized/meadow/meadowGrassConfig.js';
import { createSurfaceMaskConfig } from '/src/editor/world/ChunkRenderPixels.js';
import { generateBaseWorldChunk } from '/src/editor/world/generateWorldChunk.js';
import { createNoWaterSample } from '/src/editor/water/WaterSample.js';
import { sampleSurfaceMaskChannel } from '/src/editor/world/SurfaceMaskSampling.js';

const backend=new URLSearchParams(location.search).get('backend')??'webgpu';
const state=window.__worldGrassFixture={pendingCapture:null,continue:null,report:{backend,cases:[],checks:[],done:false}};
const renderer=new THREE.WebGPURenderer({forceWebGL:backend==='webgl',antialias:true});
renderer.setPixelRatio(1);renderer.setSize(1600,900);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);await renderer.init();
state.report.backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl';
const scene=new THREE.Scene();scene.background=new THREE.Color('#b2c9d2');
const camera=new THREE.PerspectiveCamera(68,1600/900,.1,1000);
const sun=new THREE.DirectionalLight('#fff2d9',2.5);sun.position.set(-80,100,20);scene.add(sun,new THREE.HemisphereLight('#b9daff','#7b7560',1.2));
const raw=loadEditorConfig().stylizedSurface;
async function visibleGrassPixels(field) {
 const target=new THREE.RenderTarget(1600,900);
 try {
  renderer.setRenderTarget(target);await renderer.render(scene,camera);
  const withGrass=await renderer.readRenderTargetPixelsAsync(target,0,0,1600,900);
  const meshes=field.meshes,visibility=meshes.map(m=>m.visible);meshes.forEach(m=>{m.visible=false;});
  await renderer.render(scene,camera);
  const withoutGrass=await renderer.readRenderTargetPixelsAsync(target,0,0,1600,900);
  meshes.forEach((m,i)=>{m.visible=visibility[i];});
  let changed=0;
  for(let i=0;i<withGrass.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(withGrass[i+c]-withoutGrass[i+c])))>8)changed++;
  return changed;
 }finally{renderer.setRenderTarget(null);target.dispose();}
}
async function capture(id,metadata) {
 await renderer.compileAsync(scene,camera);await renderer.render(scene,camera);
 if(renderer.backend.isWebGPUBackend)await renderer.backend.device.queue.onSubmittedWorkDone();
 state.report.cases.push({id,...metadata});state.pendingCapture=id;
 await new Promise(resolve=>{state.continue=resolve;});state.pendingCapture=null;
}
function inspect(field,border) {
 const result={blades:0,cards:0,ineligibleRoots:0,overStrengthRoots:0,fullStrengthRoots:0,fullStrengthTooNear:0,minimumFullStrengthDistance:null};
 for(const [name,layer] of [['blades',field.blades],['cards',field.cards]])for(const tile of layer?.tiles.values()??[]) {
  const out=tile.output;if(!out)continue;
  for(let i=0;i<out.count;i++) {
   const x=tile.centerX+out.position[i*4],z=tile.centerZ+out.position[i*4+2];
   // Tile centres are stored as canonical x/z by MeadowTileLayer.
   if(!Number.isFinite(x+z))throw new Error('Published tile has no canonical centre.');
   result[name]++;
   if(x<border)result.ineligibleRoots++;
   const slot=field.ground.slotFor(...field.ground.chunkOf(x,z));
   const E=sampleSurfaceMaskChannel(slot.page.surfaceMaskPixels,32,32,x/2-slot.descriptor.originCellX,-z/2-slot.descriptor.originCellZ,1);
   const strength=out.position[i*4+3];
   // A transition root can legitimately be 0.9999992. Test every root against
   // its coverage cap, then apply the full-strength rule only to published ones.
   if(strength > 0.30+0.70*E+1e-6) result.overStrengthRoots++;
   if(strength===1) {
    result.fullStrengthRoots++;
    const d=x-border;result.minimumFullStrengthDistance=Math.min(result.minimumFullStrengthDistance??Infinity,d);
    if(d<8-1e-5||E<1-1e-6){
     result.fullStrengthTooNear++;
     result.firstViolation??={x,z,strength,coverage:E};
    }
   }
  }
 }
 return result;
}
try {
 if(state.report.backend!==backend)throw new Error('Unexpected backend.');
 for(const border of [16,64]) {
  const generator={sampleTile:x=>x*2<border?2:4,sampleHeight:()=>0,sampleWater:()=>createNoWaterSample(0),toMetadata:()=>({seed:918273})};
  const slots=[],maskConfig=createSurfaceMaskConfig(raw,{tileSize:2}),maskSize=448,mask=new Uint8Array(maskSize**2*4);
  for(let cz=-7;cz<7;cz++)for(let cx=-7;cx<7;cx++) {
   const page=generateBaseWorldChunk({chunkX:cx,chunkZ:cz,chunkSize:32,worldGenerator:generator,surfaceMaskConfig:maskConfig});
   slots.push({page,pageRevision:1,descriptor:{key:`${cx}:${cz}`,chunkX:cx,chunkZ:cz,originCellX:cx*32,originCellZ:cz*32,centerWorldX:(cx+.5)*64,centerWorldZ:-(cz+.5)*64}});
   for(let z=0;z<32;z++)for(let x=0;x<32;x++)mask.set(page.surfaceMaskPixels.subarray((z*32+x)*4,(z*32+x+1)*4),(((cz+7)*32+z)*maskSize+(cx+7)*32+x)*4);
  }
  const groundTexture=new THREE.DataTexture(mask,maskSize,maskSize,THREE.RGBAFormat);groundTexture.magFilter=groundTexture.minFilter=THREE.LinearFilter;groundTexture.needsUpdate=true;
  const floorMaterial=new THREE.MeshStandardNodeMaterial();
  floorMaterial.colorNode=mix(color('#b6a276'),color('#607d33'),texture(groundTexture,vec2(positionWorld.x.add(448).div(896),positionWorld.z.negate().add(448).div(896))).g);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(896,896).rotateX(-Math.PI/2),floorMaterial);scene.add(floor);
  const terrainView={slots,worldStore:{chunkSize:32,tileSize:2,generator},floatingOrigin:{getState:()=>({x:0,z:0})},getCanonicalHeight:()=>0};
  const tuning=new GrassTuning(raw);tuning.setSettings({windStrength:0,windLean:0,windTurbulence:0,flutterStrength:0});
  const field=new MeadowGrassField({scene,terrainView,config:raw,settings:resolveMeadowGrassConfig(raw.grass.meadow),tuning,sunDirection:uniform(sun.position.clone().normalize())});
  try {
   for(const distance of [2,8,30,70]) {
    camera.position.set(border+distance,1.7,8);camera.lookAt(border,1.25,-8);camera.updateMatrixWorld();
    const start=performance.now();let ready=0;
    for(let frame=0;ready<3;frame++) {
     field.update(frame*16,camera);const stats=field.getState();
     ready=stats.building===0&&field.blades.stats.visibleMissing===0&&(field.cards?.stats.visibleMissing??0)===0?ready+1:0;
     if(performance.now()-start>120000)throw new Error(`Grass fixture preparation timeout: ${JSON.stringify(stats)}`);
     await new Promise(requestAnimationFrame);
    }
    // Keep time beyond every publication's fade; wind amplitudes are zero.
    field.uniforms.time.value=Math.max(...[...field.blades.tiles.values(),...field.cards.tiles.values()].map(t=>t.revealTime??0))+2;
    const counts=inspect(field,border),id=`border-${border}-distance-${distance}`;
    counts.visibleGrassPixels=await visibleGrassPixels(field);
    state.report.checks.push({id,...counts,passed:counts.visibleGrassPixels>1000&&counts.blades>0&&counts.cards>0&&counts.ineligibleRoots===0&&counts.overStrengthRoots===0&&counts.fullStrengthRoots>0&&counts.fullStrengthTooNear===0});
    await capture(id,{border,distance,eyeHeight:1.7,counts,readiness:field.getState(),wind:0});
   }
  }finally{field.dispose();scene.remove(floor);floor.geometry.dispose();floorMaterial.dispose();groundTexture.dispose();}
 }
 state.report.passed=state.report.checks.length===8&&state.report.checks.every(c=>c.passed);
}catch(error){state.report.failure=error.stack;state.report.passed=false;}
finally{state.report.done=true;}
