import test from 'node:test';
import assert from 'node:assert/strict';
import { downsampleTreeImpostorCapture } from '../src/editor/stylized/impostor/TreeImpostorSupersample.js';
import { encodeTreeFoliageMask, decodeTreeFoliageMaskNode, decodeTreeCanopyVisibilityNode } from '../src/editor/stylized/impostor/TreeImpostorNormalEncoding.js';
import { createTreeImpostorBakeMaterial } from '../src/editor/stylized/impostor/TreeImpostorBaker.js';
import { float } from 'three/tsl';
import { evaluateShaderNode as evaluate } from './helpers/evaluateShaderNode.js';

test('canopy visibility survives the normal-alpha bake, downsample and runtime decode', () => {
 for(const visibility of [0,.25,.5,.75,1]) {
  const material={userData:{canopyVisibilityNode:float(visibility)}};
  const bake=createTreeImpostorBakeMaterial({kind:'leaf',material},true);
  const alpha=Math.round(evaluate(bake.opacityNode)*255);
  const albedo=new Uint8Array(4*4*4),normal=new Uint8Array(albedo.length);
  for(let i=0;i<albedo.length;i+=4){albedo.set([118,80,48,255],i);normal.set([128,128,255,alpha],i);}
  const result=downsampleTreeImpostorCapture(albedo,normal,1);
  const encoded=float(result.normal[3]/255);
  assert.equal(evaluate(decodeTreeFoliageMaskNode(encoded)),1);
  assert.ok(Math.abs(evaluate(decodeTreeCanopyVisibilityNode(encoded))-visibility)<.02);
  assert.equal(result.normal[3],encodeTreeFoliageMask(1,evaluate(decodeTreeCanopyVisibilityNode(encoded))));
 }
});
test('trunk normals survive premultiplied canvas transport without becoming foliage',()=>{
 const albedo=new Uint8Array(4*4*4),normal=new Uint8Array(albedo.length);
 for(let i=0;i<albedo.length;i+=4){albedo.set([118,80,48,255],i);normal.set([90,180,230,0],i);}
 const result=downsampleTreeImpostorCapture(albedo,normal,1);
 assert.equal(result.normal[3],128);
 // Simulate the 8-bit premultiplication used by a canvas/PNG image path.
 for(let c=0;c<3;c++){
  const transported=Math.round(Math.round(result.normal[c]*128/255)*255/128);
  assert.ok(Math.abs(transported-result.normal[c])<=1);
 }
});
test('offline downsampling preserves linear colour, normal direction and foliage class',()=>{
 const size=4,scale=4,albedo=new Uint8Array(size*size*scale*scale*4),normal=new Uint8Array(albedo.length);
 for(let i=0;i<albedo.length;i+=4){albedo.set([118,80,48,255],i);normal.set([128,128,255,255],i);}
 const result=downsampleTreeImpostorCapture(albedo,normal,size);
 for(let i=0;i<result.albedo.length;i+=4){assert.deepEqual(Array.from(result.albedo.subarray(i,i+4)),[118,80,48,255]);assert.deepEqual(Array.from(result.normal.subarray(i,i+4)),[128,128,255,255]);}
});
test('thin foliage coverage survives the fixed 0.5 atlas cutoff',()=>{
 const size=8,sourceSize=size*4,albedo=new Uint8Array(sourceSize*sourceSize*4),normal=new Uint8Array(albedo.length);let covered=0;
 for(let y=0;y<sourceSize;y++)for(let x=0;x<sourceSize;x++)if((x+2*y)%7<2){const i=(y*sourceSize+x)*4;albedo.set([118,80,48,255],i);normal.set([128,128,255,255],i);covered++;}
 const result=downsampleTreeImpostorCapture(albedo,normal,size);let retained=0;
 for(let i=3;i<result.albedo.length;i+=4){
  if(result.albedo[i]>=128)retained++;
  if(result.normal[i]>=128)assert.ok(result.albedo[i]>=128,'foliage class must be inside visible tree coverage');
 }
 assert.ok(retained/(size*size)>=covered/(sourceSize*sourceSize));
 assert.throws(()=>downsampleTreeImpostorCapture(new Uint8Array(3),normal,size),/capture/);
});
