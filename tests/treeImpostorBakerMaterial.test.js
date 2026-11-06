import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, NoBlending, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import {
  createTreeImpostorBakeMaterial,
  createTreeImpostorBakeTargets,
  createBakeGeometry,
} from '../src/editor/stylized/impostor/TreeImpostorBaker.js';
import {createCaptureDirections,impostorCanvasRow} from '../src/editor/stylized/impostor/impostorFrame.js';

test('bake targets encode PNG albedo once while normals remain linear',()=>{
 const targets=createTreeImpostorBakeTargets(120);
 assert.equal(targets.albedo.texture.colorSpace,SRGBColorSpace);
 assert.equal(targets.normal.texture.colorSpace,NoColorSpace);
 assert.equal(targets.albedo.width,120);assert.equal(targets.normal.height,120);
 targets.albedo.dispose();targets.normal.dispose();
});

test('bake geometry supplies neutral authored appearance without changing source geometry',()=>{
 const source=new BoxGeometry(1,2,1),geometry=createBakeGeometry(source);
 const dither=geometry.getAttribute('instanceDither');
 assert.equal(dither.count,geometry.getAttribute('position').count);
 for(let i=0;i<dither.count;i++)assert.deepEqual([dither.getX(i),dither.getY(i),dither.getZ(i)],[1,.5,1]);
 assert.equal(source.getAttribute('instanceDither'),undefined);
 assert.ok(source.index);assert.equal(geometry.index,null);
 source.dispose();geometry.dispose();
});

test('each baked elevation occupies the canvas row selected by its texture UV',()=>{
 const rows=2,columns=8,tileSize=128;
 for(const direction of createCaptureDirections({rows,columns,lowElevationDegrees:12,highElevationDegrees:58})) {
  const canvasY=(impostorCanvasRow(direction.row,rows)+.5)*tileSize;
  const loadedV=1-canvasY/(rows*tileSize);
  assert.equal(Math.floor(loadedV*rows),direction.row);
 }
});

test('normal bake writes foliage classification through material opacity', () => {
  const sourceMap = new Texture();
  const leaf = createTreeImpostorBakeMaterial({
    kind: 'leaf',
    sourceMap,
    material: { alphaTest: 0.61 },
  }, true);
  const trunk = createTreeImpostorBakeMaterial({ kind: 'trunk' }, true);

  try {
    assert.equal(leaf.opacityNode?.value, 1);
    assert.equal(trunk.opacityNode?.value, 0);
    assert.equal(leaf.blending, NoBlending);
    assert.equal(trunk.blending, NoBlending);
    const maskTextureNode = leaf.maskNode.aNode.node;
    assert.equal(maskTextureNode.uvNode, null);
    assert.equal(maskTextureNode.updateMatrix, true);
    assert.equal(leaf.maskNode.bNode.value, 0.61);
  } finally {
    leaf.dispose();
    trunk.dispose();
  }
});
