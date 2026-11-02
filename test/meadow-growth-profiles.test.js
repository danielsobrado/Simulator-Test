import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { MEADOW_GROWTH_DEFAULTS, resolveMeadowGrowth } from '../src/editor/stylized/meadow/meadowGrowthProfiles.js';
import { meadowGrowthHeight, acceptsMeadowHabitat } from '../src/editor/stylized/meadow/meadowGrowthMath.js';
import { MEADOW_CARD_HEIGHT_CONTRAST, MEADOW_SHORT_FLOOR } from '../src/editor/stylized/meadow/meadowTuftField.js';
import { encodeLookTable } from '../src/editor/stylized/meadow/meadowPalettes.js';
import { resolveMeadowGrassConfig } from '../src/editor/stylized/meadow/meadowGrassConfig.js';
import { createMeadowUniforms } from '../src/editor/stylized/meadow/meadowUniforms.js';
import { meadowBladeBoundsPadding, meadowCardBoundsPadding } from '../src/editor/stylized/meadow/MeadowPageBounds.js';
import { GrassTuning } from '../src/editor/stylized/GrassTuning.js';
import { reconcileMeadowGrowth, meadowPageGrowthKey } from '../src/editor/stylized/meadow/MeadowGrowthUpdates.js';

const surface=load(readFileSync(new URL('../editor.config.yaml',import.meta.url),'utf8')).stylizedSurface;
const rows=[
 [0,0,0,0,12,'slender',1],[0,0,0,0,12,'slender',1],[0,0,0,0,12,'slender',1],
 [.25,.85,.050,.72,14,'slender',1],[.24,.82,.045,.92,17,'slender',1],[.16,.50,.060,.85,11,'broadleaf',.6],
 [.16,.44,.042,.85,10,'slender',.85],[.14,.48,.065,.82,12,'broadleaf',.25],[.18,.52,.062,.78,10,'broadleaf',.3],
 [.13,.34,.050,.80,12,'slender',.7],[.06,.16,.028,.28,7,'slender',.8],[0,0,0,0,12,'slender',1],[.14,.60,.045,.50,5,'reed',.2],
];
const record=values=>Object.fromEntries(['shortHeight','tallHeight','width','density','patchMeters','shape','areaStyle'].map((k,i)=>[k,values[i]]));
test('all thirteen shipped growth rows match their exact specification and custom IDs use grassland',()=>{
 const g=resolveMeadowGrowth(surface.grass.meadow.growth);
 for(let id=0;id<13;id++) {
  assert.deepEqual(MEADOW_GROWTH_DEFAULTS[id],record(rows[id]));
  assert.deepEqual(g.profiles[g.table[id]],record(rows[id]));
 }
 assert.equal(g.table[14],0);assert.equal(g.table[254],0);
 assert.deepEqual(g.profiles[0],record(rows[4]));
 const custom=resolveMeadowGrowth({byTileId:{254:{tallHeight:.8,density:.3,shape:'reed'}}});
 assert.equal(custom.profiles[custom.table[254]].tallHeight,.8);assert.equal(custom.shapes[254],1);
 assert.equal(resolveMeadowGrowth({byTileId:{32:{...MEADOW_GROWTH_DEFAULTS[9]}}}).table[32],g.table[9]);
});
test('invalid growth values and excessive distinct profiles name their exact config path',()=>{
 for(const [key,value] of [['shortHeight',NaN],['tallHeight',-.1],['width',0],['density',1.01],['patchMeters',1.99],['patchMeters',64.01],['shape','fern']]) {
  assert.throws(()=>resolveMeadowGrowth({byTileId:{9:{[key]:value}}}),new RegExp(`stylizedSurface.grass.meadow.growth.byTileId.9.${key}`));
 }
 assert.throws(()=>resolveMeadowGrowth({byTileId:{9:{shortHeight:.5,tallHeight:.3}}}),/byTileId.9.tallHeight/);
 assert.throws(()=>resolveMeadowGrowth({byTileId:{256:{density:0}}}),/byTileId.256/);
 const overrides={};for(let i=32;i<50;i++)overrides[i]={shortHeight:.18+i*.001};
 assert.throws(()=>resolveMeadowGrowth({byTileId:overrides}),/growth exceeds 16 profiles/);
});
test('every shape/palette/growth/card variant round trips exactly through Uint16 look codes and float storage',()=>{
 for(let growth=0;growth<16;growth++)for(let palette=0;palette<8;palette++)for(let shape=0;shape<3;shape++) {
  const codes=encodeLookTable(new Uint8Array(256).fill(shape),new Uint8Array(256).fill(palette),new Uint8Array(256).fill(growth));
  assert.ok(codes instanceof Uint16Array);
  for(let id=0;id<256;id++) {
   const code=codes[id];assert.equal(code%3,shape);assert.equal(Math.floor(code/3)%8,palette);assert.equal(Math.floor(code/24),growth);
   for(let variant=0;variant<4;variant++) {
    const packed=Math.fround(code*4+variant),unpacked=Math.floor(packed/4);
    assert.equal(unpacked,code);assert.equal((unpacked%3)*4+packed%4,shape*4+variant);
   }
  }
 }
});
test('10000 canonical candidates per biome retain specified height range, card ratio and density',()=>{
 const growth=resolveMeadowGrowth();
 for(let id=0;id<13;id++) {
  const p=growth.profiles[growth.table[id]];let accepted=0;
  for(let i=0;i<10000;i++) {
   const x=-8000000+(i*13.7147)%2000,z=4000000-(i*71.213)%2000;
   const h=meadowGrowthHeight(p,x,z),card=meadowGrowthHeight(p,x,z,true);
   assert.ok(h>=p.shortHeight*MEADOW_SHORT_FLOOR-1e-12&&h<=p.tallHeight+1e-12);
   const short=p.shortHeight*MEADOW_SHORT_FLOOR,mid=(short+p.tallHeight)/2;
   assert.ok(Math.abs(card/1.125-mid)<=(p.tallHeight-short)/2*MEADOW_CARD_HEIGHT_CONTRAST+1e-12);assert.ok((card/1.125-mid)*(h-mid)>=-1e-12);
   const width=p.width*(.88+.24*(i/9999));assert.ok(width>=p.width*.88&&width<=p.width*1.12);
   if(acceptsMeadowHabitat(x,z,918273,1,p.density))accepted++;
  }
  assert.ok(Math.abs(accepted/10000-p.density)<.01,`biome ${id}: ${accepted}`);
 }
 const settings=resolveMeadowGrassConfig(surface.grass.meadow),uniforms=createMeadowUniforms(settings),tuning=new GrassTuning(surface).uniforms;
 assert.equal(uniforms.growth.dimensions.array.length,16);assert.equal(uniforms.growth.density.array.length,16);
 for(const padding of [meadowBladeBoundsPadding(uniforms,tuning),meadowCardBoundsPadding(uniforms)])assert.ok(Number.isFinite(padding)&&padding>=.95);
});
test('live profile updates preserve unaffected uniform slots and page revision keys',()=>{
 const old=resolveMeadowGrowth(),next=reconcileMeadowGrowth(old,resolveMeadowGrowth({byTileId:{9:{density:.4}}}));
 const looks=g=>encodeLookTable(g.shapes,null,g.table);
 for(const id of [3,4,5,6,7,8,10,12,254]) {
  assert.equal(old.table[id],next.table[id]);
  assert.equal(meadowPageGrowthKey(Uint8Array.of(id),old,looks(old)),meadowPageGrowthKey(Uint8Array.of(id),next,looks(next)));
 }
 assert.notEqual(meadowPageGrowthKey(Uint8Array.of(9),old,looks(old)),meadowPageGrowthKey(Uint8Array.of(9),next,looks(next)));
 const changedFallback=reconcileMeadowGrowth(old,resolveMeadowGrowth({byTileId:{4:{tallHeight:.7},32:{...MEADOW_GROWTH_DEFAULTS[4]}}}));
 assert.equal(changedFallback.table[254],0);assert.equal(changedFallback.profiles[changedFallback.table[32]].tallHeight,.82);
});
