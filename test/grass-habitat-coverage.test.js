import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRASS_BARREN_EDGE_METERS,
  grassHabitatCoverage,
  grassHabitatEdge,
  grassHabitatEligible,
} from '../src/editor/world/GrassHabitatCoverage.js';
import { buildSurfaceMaskPixels, createSurfaceMaskConfig } from '../src/editor/world/ChunkRenderPixels.js';
import { generateBaseWorldChunk } from '../src/editor/world/generateWorldChunk.js';
import { createEditedChunkSampling } from '../src/editor/world/EditedChunkSampling.js';
import { createNoWaterSample } from '../src/editor/water/WaterSample.js';

const config = { ...createSurfaceMaskConfig(null), tileSize: 2 };
function generator(tile = (x) => x < 0 ? 2 : 4) {
  return { seaLevel: -1.5, sampleTile: tile, sampleHeight: () => 0,
    sampleWater: () => createNoWaterSample(0), toMetadata: () => ({ seed: 918273 }) };
}
function fallback(g, x, z, size, maskConfig = config) {
  const tiles = Uint8Array.from({ length: size ** 2 }, (_, i) => g.sampleTile(x + i % size, z + Math.floor(i / size)));
  const heights = Float32Array.from({ length: (size + 1) ** 2 }, (_, i) => g.sampleHeight(x + i % (size + 1), z + Math.floor(i / (size + 1))));
  return buildSurfaceMaskPixels({ tiles, heights, originX: x, originZ: z, chunkSize: size,
    sampleTile: (a,b) => g.sampleTile(a,b), sampleHeight: (a,b) => g.sampleHeight(a,b),
    // The world seed rides in the mask config, as both production paths pass it.
    sampleWater: (a,b) => g.sampleWater(a,b), maskConfig: { ...maskConfig, worldSeed: g.toMetadata?.().seed ?? 0 } });
}
const grass = (pixels, size, x, z) => pixels[(z * size + x) * 4 + 1];

test('half-plane has the inward barren-land fringe and a bare desert side', () => {
  const pixels = fallback(generator(), -8, -8, 16);
  // A desert is barren land: the sward thins over GRASS_BARREN_EDGE_METERS, not the shore's 8 m.
  const expected = Array.from({ length: 8 }, (_, x) => grassHabitatEdge(x + 1, 2, GRASS_BARREN_EDGE_METERS));
  assert.ok(expected[3] < 0.5, 'still thinning eight metres in');
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 8; x++) assert.equal(grass(pixels,16,x,z), 0);
    for (let x = 0; x < expected.length; x++) assert.ok(Math.abs(grass(pixels,16,x+8,z)/255-expected[x]) <= 1/255);
  }
});

test('diagonal border and isolated island retain only eligible roots', () => {
  for (const tile of [(x,z) => x >= z ? 4 : 2, (x,z) => Math.abs(x)<3 && Math.abs(z)<3 ? 4 : 2]) {
    const g = generator(tile), pixels = fallback(g,-8,-8,16);
    for (let z=0;z<16;z++)for(let x=0;x<16;x++) {
      const value=grass(pixels,16,x,z);
      if(tile(x-8,z-8)!==4)assert.equal(value,0);
      else assert.ok(value>0);
    }
    assert.ok(grass(pixels,16,8,8)<255);
  }
});

test('seedless all-eligible and all-ineligible fields produce exact finite bytes', () => {
  assert.deepEqual([...grassHabitatCoverage(new Uint8Array(81).fill(1),9,9,2)],new Array(81).fill(255));
  assert.deepEqual([...grassHabitatCoverage(new Uint8Array(81),9,9,2)],new Array(81).fill(0));
  const ids=new Set([4]);
  assert.equal(grassHabitatEligible({tileId:4,snow:.75},ids),false);
  assert.equal(grassHabitatEligible({tileId:4,snow:.749,water:.999},ids),true);
  assert.equal(grassHabitatEligible({tileId:4,water:1},ids),false);
});

test('snow and water halo use identical classification and half-float precision across negative chunks', () => {
  const classification = { snowLine:700,snowFade:250,snowSlopeMax:.55,snowBiomeCover:{10:.35,11:1},
    snowPatchScale:60,snowPatchStrength:.45,snowWindShift:.25,snowConcavity:4 };
  const cases = [
    { g:generator((x) => x < -16 ? 11 : 4), config:{...config,grassTileIds:[4,11],snow:{classification,seedOffset:2401,tileSize:2}} },
    { g:{...generator(()=>4),sampleWater:(x)=>({coverage:x< -16?1:.33337,depth:x< -16?.70013:.100013})},config },
    { g:generator((x,z)=>x+z< -32?2:4),config },
  ];
  for(const c of cases) {
    const whole=fallback(c.g,-32,-32,32,c.config);
    for(const [cx,cz] of [[-2,-2],[-1,-2],[-2,-1],[-1,-1]]) {
      const page=generateBaseWorldChunk({chunkX:cx,chunkZ:cz,chunkSize:16,worldGenerator:c.g,surfaceMaskConfig:c.config});
      const sync=fallback(c.g,cx*16,cz*16,16,c.config);
      assert.deepEqual(page.surfaceMaskPixels,sync,'worker and fallback bytes');
      for(let z=0;z<16;z++)for(let x=0;x<16;x++)for(let channel=0;channel<4;channel++) {
        assert.equal(sync[(z*16+x)*4+channel],whole[(((cz+2)*16+z)*32+(cx+2)*16+x)*4+channel]);
      }
    }
  }
});

test('edited corner influences all adjoining pages with exactly matching halo outputs', () => {
  const g=generator(()=>4),overrides={tiles:[[-16,-16,2]],heights:[]};
  const edited=createEditedChunkSampling(g,16,overrides),whole=fallback(edited,-32,-32,32);
  for(const [cx,cz] of [[-2,-2],[-1,-2],[-2,-1],[-1,-1]]) {
    const page=generateBaseWorldChunk({chunkX:cx,chunkZ:cz,chunkSize:16,worldGenerator:g,surfaceMaskConfig:config,terrainOverrides:overrides});
    for(let z=0;z<16;z++)for(let x=0;x<16;x++)assert.equal(grass(page.surfaceMaskPixels,16,x,z),grass(whole,32,(cx+2)*16+x,(cz+2)*16+z));
  }
});
