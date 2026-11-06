import { foliageMipmaps } from './alphaCoverage.js';
import { encodeTreeFoliageMask } from './TreeImpostorNormalEncoding.js';
export const TREE_IMPOSTOR_CAPTURE_SCALE = 4;
const decode=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
const encode=v=>Math.round(255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));

/** Offline antialiasing retains source coverage with the existing foliage mip rule. */
export function downsampleTreeImpostorCapture(albedo,normal,size,scale=TREE_IMPOSTOR_CAPTURE_SCALE) {
 const sourceSize=size*scale,expected=sourceSize*sourceSize*4;
 if(albedo.length!==expected||normal.length!==expected||!Number.isInteger(Math.log2(scale)))throw new Error('Invalid supersampled tree capture.');
 const coverage=foliageMipmaps(albedo,sourceSize,sourceSize,.5)[Math.log2(scale)].data;
 const colour=new Uint8Array(size*size*4),normals=new Uint8Array(colour.length);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  const rgb=[0,0,0],n=[0,0,0];let weight=0,leaf=0,sky=0;
  for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++) {
   const i=((y*scale+dy)*sourceSize+x*scale+dx)*4,a=albedo[i+3]/255;
   weight+=a;
   const foliage=normal[i+3]>=128?1:0;
   leaf+=foliage*a;sky+=Math.max(0,normal[i+3]/255*2-1)*foliage*a;
   for(let c=0;c<3;c++){rgb[c]+=decode(albedo[i+c])*a;n[c]+=(normal[i+c]/255*2-1)*a;}
  }
  const i=(y*size+x)*4,length=Math.hypot(...n)||1;
  for(let c=0;c<3;c++){colour[i+c]=weight?encode(rgb[c]/weight):0;normals[i+c]=Math.round((n[c]/length*.5+.5)*255);}
  colour[i+3]=coverage[i+3];
  normals[i+3]=colour[i+3]>=128&&weight?encodeTreeFoliageMask(leaf/weight,leaf?sky/leaf:1):0;
 }
 return {albedo:colour,normal:normals};
}
