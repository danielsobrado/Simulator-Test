import { runTreeAlphaCoverage } from './world-visual-tree-alpha.mjs';
import * as THREE from 'three/webgpu';
import { normalWorld, vec3 } from 'three/tsl';
import { loadEditorConfig } from '/src/config/loadEditorConfig.js';
import { StylizedTreeView } from '/src/editor/stylized/StylizedTreeView.js';
import { StylizedSceneAssetCache } from '/src/editor/stylized/StylizedSceneAssetCache.js';
import { createTreeProxyPrototype } from '/src/editor/stylized/lod/StylizedProxyGeometry.js';
import { createInstancedRenderers,writeInstances,disposeInstancedRenderers } from '/src/editor/stylized/lod/StylizedLodRuntime.js';
import { TreeImpostorAssetLoader,disposeTreeImpostorAtlases } from '/src/editor/stylized/impostor/TreeImpostorAssets.js';
import { createTreeImpostorSourceSignature } from '/src/editor/stylized/impostor/TreeImpostorManifest.js';
import { CpuTreeImpostorBatch } from '/src/editor/stylized/impostor/CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from '/src/editor/stylized/impostor/GpuTreeImpostorBatch.js';
import { syncFoliageLight } from '/src/editor/stylized/forest/foliageLight.js';
import { jungleMistUniforms } from '/src/editor/stylized/ambient/JungleMist.js';
import { applyFixtureLighting } from './world-visual-fixture-lighting.mjs';

const assets=['/assets/grass-scene.glb','/assets/trees/meadow/tree7.glb','/assets/trees/tree-scene/tree-02.glb','/assets/trees/forest-pack/tree-narrow-01.glb','/assets/trees/alpine/tree10.glb'];
class FixtureTreeView extends StylizedTreeView {
 createRenderResources() {
  this.proxyPrototypes=this.prototypes.map(parts=>this.withCloudShadow(createTreeProxyPrototype(parts,this.config).proxyParts));
 }
}
const median=values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length/2)]:null;};
function compare(near,other) {
 let nearCoverage=0,otherCoverage=0;const ratios=[],errors=[];
 for(let i=0;i<near.length;i+=4) {
  if(near[i+3]>=.5)nearCoverage++;if(other[i+3]>=.5)otherCoverage++;
  if(near[i+3]<.9||other[i+3]<.9)continue;
  const a=.2126*near[i]+.7152*near[i+1]+.0722*near[i+2];
  const b=.2126*other[i]+.7152*other[i+1]+.0722*other[i+2];
  if(a>1e-6)ratios.push(b/a);
  errors.push(Math.hypot(other[i]-near[i],other[i+1]-near[i+1],other[i+2]-near[i+2]));
 }
 return {sharedInterior:errors.length,nearCoverage,otherCoverage,coverageRatio:otherCoverage/nearCoverage,
  medianLuminanceRatio:median(ratios),medianRgbError:median(errors)};
}
export async function runTreeRepresentations({renderer,scene,camera,draw,state,sun,fill,fixtureLight='neutral',treeDiagnostic=null}) {
 const original=loadEditorConfig().stylizedSurface,config=structuredClone(original);
 config.trees.windStrength=0;config.sky.cloudShadows.enabled=false;
 const terrainView={scene,renderer,worldStore:{tileSize:2,chunkSize:32,revision:0},getCanonicalHeight:()=>0};
 const view=new FixtureTreeView({terrainView,config,revisionTracker:{revision:0}});
 const cache=new StylizedSceneAssetCache({renderer});let atlases;
 try {
  const primary=await cache.acquire(config.assets.scene),variants=[];
  for(const definition of config.assets.treeVariants)variants.push({definition,scene:await cache.acquire(definition.scene)});
  await view.buildFromScene(primary,variants);view.time.value=0;
  const signature=createTreeImpostorSourceSignature(view.prototypes,original);
  atlases=await new TreeImpostorAssetLoader({renderer,compressed:config.lod.impostor.compressed!==false,
   expectedPrototypeCount:view.prototypes.length,expectedSourceSignature:signature}).load(config.lod.impostor.manifest);
  if(!atlases)throw new Error('Required checked-in impostor atlas is unavailable.');
  state.report.prototypeSignature=signature;jungleMistUniforms.weight.value=0;
  camera.fov=35;camera.updateProjectionMatrix();sun.intensity=1;fill.intensity=.4;
  const lighting=applyFixtureLighting(original,sun,fill,fixtureLight);
  for(const asset of treeDiagnostic ? assets.slice(-1) : assets) {
   const index=view.prototypeIndicesByAsset.get(asset)?.[0];
   if(!Number.isInteger(index))throw new Error(`No production prototype for ${asset}.`);
   const parts=view.prototypes[index],atlas=atlases.find(a=>a.prototypeIndex===index),bounds=new THREE.Box3();
   const foliageLighting=parts.some(part=>part.kind==='leaf'&&Boolean(part.material.emissiveNode));
   state.report.checks.push({id:`tree-foliage-lighting-metadata-${index}`,expected:foliageLighting,actual:atlas.foliageLighting,
    passed:foliageLighting===atlas.foliageLighting});
   const barkLighting=parts.some(part=>part.kind==='trunk'&&part.material.userData.barkLighting===true);
   state.report.checks.push({id:`tree-bark-lighting-metadata-${index}`,expected:barkLighting,actual:atlas.barkLighting,
    passed:barkLighting===atlas.barkLighting});
   bounds.makeEmpty();for(const part of parts){part.geometry.computeBoundingBox();bounds.union(part.geometry.boundingBox);}
   const height=bounds.max.y-bounds.min.y,center=bounds.getCenter(new THREE.Vector3());
   const elevation=THREE.MathUtils.degToRad(atlas.lowElevationDegrees);
   const place=distance=>{camera.position.copy(center).add(new THREE.Vector3(0,Math.sin(elevation),Math.cos(elevation)).multiplyScalar(distance));camera.lookAt(center);camera.updateMatrixWorld();};
   const projected=()=>{let low=Infinity,high=-Infinity;for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
    const value=new THREE.Vector3(x,y,z).project(camera).y;low=Math.min(low,value);high=Math.max(high,value);
   }return (high-low)*300;};
   let lower=height,upper=height*100;
   for(let i=0;i<40;i++){const distance=(lower+upper)/2;place(distance);if(projected()>240)lower=distance;else upper=distance;}
   const distance=(lower+upper)/2;place(distance);
   const metadata={asset,prototypeIndex:index,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},distance,
    fov:35,projectedHeightPixels:projected(),elevationDegrees:atlas.lowElevationDegrees,wind:0,phase:0,appearance:[1,1,1,1],
    compressedAlbedo:Boolean(atlas.albedo.isCompressedTexture),foliageLighting};
   const root=new THREE.Group();scene.add(root);
   const near=createInstancedRenderers({root,partsByPrototype:[parts],capacity:1,name:'fixture-near',tintLeaves:true,renderer});
   const proxy=createInstancedRenderers({root,partsByPrototype:[view.proxyPrototypes[index]],capacity:1,name:'fixture-proxy',tintLeaves:true,renderer});
   const instance={matrix:new THREE.Matrix4(),fade:1,seed:.5,colorVariation:1,leafTint:[1,1,1],morphology:[1,1,1]};
   writeInstances(near,[[instance]]);writeInstances(proxy,[[instance]]);
   const cpu=new CpuTreeImpostorBatch({scene,atlas,capacity:1,name:'fixture-cpu',ambientEffects:config.ambientEffects});
   const gpu=renderer.backend.isWebGPUBackend?new GpuTreeImpostorBatch({renderer,scene,atlas,capacity:1,name:'fixture-gpu',ambientEffects:config.ambientEffects}):null;
   const records=[{x:center.x,y:atlas.centerY,z:center.z,scale:1,yaw:0,fade:1,seed:.5,radius:atlas.radius,appearance:[1,1,1,1]}];
   for(const batch of [cpu,gpu].filter(Boolean)){batch.uniforms.windStrength.value=0;batch.setRecords(records);batch.update(camera,{x:0,z:0},0);}
   const groups={near:near.flat(),proxy:proxy.flat(),'cpu-impostor':[cpu.mesh],...(gpu?{'gpu-impostor':[gpu.mesh]}:{})};
   if(treeDiagnostic)for(const mesh of Object.values(groups).flat()) {
    const material=mesh.material;
    material.emissiveNode=treeDiagnostic==='normals'?normalWorld.mul(.5).add(.5):material.colorNode;
    material.colorNode=vec3(0);
   }
   try {
    for(const azimuth of [0,90,180,270]) {
     const angle=THREE.MathUtils.degToRad(azimuth),sunElevation=THREE.MathUtils.degToRad(42);
     sun.position.set(Math.sin(angle)*Math.cos(sunElevation)*100,Math.sin(sunElevation)*100,Math.cos(angle)*Math.cos(sunElevation)*100);
     sun.target.position.set(0,0,0);sun.target.updateMatrixWorld();syncFoliageLight({directional:sun,hemisphere:fill});
     const images={};
     for(const [representation,meshes] of Object.entries(groups)) {
      for(const all of Object.values(groups))for(const mesh of all)mesh.visible=false;
      for(const mesh of meshes)mesh.visible=true;
      images[representation]=await draw(`tree-${index}-${azimuth}-${representation}`,{...metadata,azimuth,representation,lighting},true);
     }
     for(const representation of ['cpu-impostor',...(gpu?['gpu-impostor']:[])]) {
      const stats=compare(images.near,images[representation]);
      state.report.checks.push({id:`tree-material-${index}-${azimuth}-${representation}`,...stats,
       passed:stats.sharedInterior>=1000&&stats.medianLuminanceRatio>=.8&&stats.medianLuminanceRatio<=1.25&&stats.medianRgbError<=.12});
     }
    }
    await runTreeAlphaCoverage({atlas,center,draw,metadata,cpu,gpu,groups,state});
   }finally {
    disposeInstancedRenderers(root,near);disposeInstancedRenderers(root,proxy);scene.remove(root);cpu.dispose();gpu?.dispose();
   }
  }
 }finally {view.dispose();disposeTreeImpostorAtlases(atlases);cache.dispose();}
}
