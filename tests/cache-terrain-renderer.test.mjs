import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVisibleFloor, isSharedOcean, pointInFloorShape, maskSurfacePixels,
  makeFloorGrid, isEmptyOceanSurface } from '../scripts/render-cache-terrain.mjs';

const full = [{subx:0,subz:0},{subx:1,subz:0},{subx:1,subz:1},{subx:0,subz:1}];
const half = [{subx:0,subz:0},{subx:1,subz:0},{subx:0,subz:1}];
function tile({water=false,color=[80,80,80],shape=full,underlay=false,plane=0,settings=0}={}) {
  return {hasFloor:true,settings,effectiveLevel:plane,underlayVisible:underlay,
    shape:{overlay:shape,underlay:full},overlayprops:{color},rawOverlay:{color},
    ...(water?{waterProps:{shape,props:{color},rawOverlay:{color}}}: {})};
}
function pixels() {
  const rgba=new Uint8Array(256*256*4);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  return rgba;
}
function oceanPixels() {
  const rgba=pixels();
  for(let i=0;i<rgba.length;i+=4)rgba.set([96,118,154,255],i);
  return rgba;
}
function grid(entries) {return {getTile(x,z,p){return entries.get(`${p}:${x}:${z}`);}};}
const sample = (rgba,x,y) => rgba[(y*256+x)*4+3];

test('floor coverage requires a visible definition, preserving real gray and black',()=>{
  const unset=tile({color:[255,0,255],shape:[]});
  assert.equal(hasVisibleFloor(unset),false);
  assert.equal(hasVisibleFloor(tile({color:[0,0,0]})),true);
  assert.equal(hasVisibleFloor(tile({color:[77,77,77]})),true);
  assert.equal(hasVisibleFloor({...unset,underlayVisible:true}),true);
});

test('shared ocean requires water properties and exact map water definition colour',()=>{
  assert.equal(isSharedOcean(tile({water:true,color:[96,118,154]})),true);
  assert.equal(isSharedOcean(tile({color:[96,118,154]})),false);
  assert.equal(isSharedOcean(tile({water:true,color:[0,90,130]})),false);
  const secondary=tile({water:true,color:[255,0,255]});
  secondary.waterProps.rawOverlay.secondary_colour=[96,118,154];
  assert.equal(isSharedOcean(secondary),true);
});

test('empty/ocean shortcut rejects any shore, special-colour water or building floor',()=>{
  assert.equal(isEmptyOceanSurface(grid(new Map()),{x:0,z:0}),true);
  const entries=new Map([['0:0:0',tile({water:true,color:[96,118,154]})]]);
  assert.equal(isEmptyOceanSurface(grid(entries),{x:0,z:0}),true);
  for(const land of [tile({water:true,color:[96,118,154],shape:half}),tile({water:true}),tile({underlay:true})]) {
    entries.set('0:1:0',land);
    assert.equal(isEmptyOceanSurface(grid(entries),{x:0,z:0}),false);
  }
});

test('unset floor pixels clear alpha and RGB rather than treating shades as void',()=>{
  const rgba=pixels(),entries=new Map([['0:0:0',tile({underlay:true})]]);
  assert.deepEqual(maskSurfacePixels(rgba,grid(entries),{x:0,z:0}),
    {artworkPixels:16,oceanPixels:0,voidPixels:65520});
  assert.equal(sample(rgba,0,255),255);
  assert.equal(sample(rgba,0,0),0);
  assert.deepEqual([...rgba.slice(0,4)],[0,0,0,0]);
});

test('fully ocean coverage produces a valid transparent surface instead of a gray block',()=>{
  const rgba=oceanPixels(),ocean=tile({water:true,color:[96,118,154]});
  const counts=maskSurfacePixels(rgba,{getTile:(_x,_z,p)=>p===0?ocean:undefined},{x:57,z:38});
  assert.deepEqual(counts,{artworkPixels:0,oceanPixels:65536,voidPixels:0});
  assert.equal(rgba.every(n=>n===0),true);
});

test('partial water shapes preserve shoreline land and follow north-up pixels',()=>{
  const rgba=oceanPixels(),shore=tile({water:true,color:[96,118,154],shape:half,underlay:true});
  maskSurfacePixels(rgba,grid(new Map([['0:0:0',shore]])),{x:0,z:0});
  assert.equal(sample(rgba,0,255),0); // southwest lies in water triangle
  assert.equal(sample(rgba,3,252),255); // northeast is land
  assert.equal(pointInFloorShape(half,.125,.125),true);
  assert.equal(pointInFloorShape(half,.875,.875),false);
});

test('wall strokes and rendered shoreline edges remain visible on definition-backed water',()=>{
  const rgba=oceanPixels();
  rgba.set([159,172,194,255],(255*256+0)*4); // antialiased white wall over ocean
  rgba.set([80,70,30,255],(255*256+1)*4); // crisp shoreline boundary raster
  const ocean=tile({water:true,color:[96,118,154]});
  const counts=maskSurfacePixels(rgba,{getTile:(_x,_z,p)=>p===0?ocean:undefined},{x:0,z:0});
  assert.equal(sample(rgba,0,255),255);
  assert.equal(sample(rgba,1,255),255);
  assert.equal(sample(rgba,2,255),0);
  assert.equal(counts.artworkPixels,2);
});

test('magenta overlay cut-outs keep only their complementary underlay or lower floor',()=>{
  const cutout=tile({color:[255,0,255],shape:half,underlay:true});
  cutout.shape.underlay=[{subx:1,subz:0},{subx:1,subz:1},{subx:0,subz:1}];
  const rgba=pixels();
  maskSurfacePixels(rgba,grid(new Map([['0:0:0',cutout]])),{x:0,z:0});
  assert.equal(sample(rgba,0,255),0);
  assert.equal(sample(rgba,3,252),255);
  cutout.effectiveLevel=0;
  const stacked=pixels();
  maskSurfacePixels(stacked,grid(new Map([['1:0:0',cutout],['0:0:0',tile({underlay:true})]])),{x:0,z:0});
  assert.equal(sample(stacked,0,255),255);
});

test('definition-backed void keeps nonblack raster edges but removes the black SVG background',()=>{
  const rgba=pixels(),cutout=tile({color:[255,0,255],shape:half,underlay:true});
  cutout.shape.underlay=[{subx:1,subz:0},{subx:1,subz:1},{subx:0,subz:1}];
  rgba.set([103,75,17,255],(255*256+0)*4);
  maskSurfacePixels(rgba,grid(new Map([['0:0:0',cutout]])),{x:0,z:0});
  assert.equal(sample(rgba,0,255),255);
  assert.equal(sample(rgba,1,255),0);
  assert.equal(sample(rgba,3,252),255); // legitimate black underlay in this fixture
});

test('visible upper floors and bridge floors retain artwork over water',()=>{
  for(const settings of [0,8]) {
    const rgba=pixels(),ocean=tile({water:true,color:[96,118,154]}),upper=tile({underlay:true});
    upper.effectiveLevel=settings?1:0;upper.settings=settings;
    const entries=new Map([['0:0:0',ocean],['1:0:0',upper]]);
    maskSurfacePixels(rgba,grid(entries),{x:0,z:0});
    assert.equal(sample(rgba,0,255),255);
  }
});

test('higher hidden floors do not cover water, special water and blue building floors stay',()=>{
  const rgba=oceanPixels(),entries=new Map([
    ['0:0:0',tile({water:true,color:[96,118,154]})],
    ['1:0:0',tile({underlay:true,plane:1})],
    ['0:1:0',tile({water:true,color:[30,50,70]})],
    ['0:2:0',tile({color:[96,118,154]})],
  ]);
  maskSurfacePixels(rgba,grid(entries),{x:0,z:0});
  assert.equal(sample(rgba,0,255),0);
  assert.equal(sample(rgba,4,255),255);
  assert.equal(sample(rgba,8,255),255);
});

test('NXT visible bit with unset definitions has no floor while wall metadata stays available',()=>{
  class TileProps {
    constructor(_h,settings){this.settings=settings;this.shape={overlay:[],underlay:full};
      this.overlayprops={color:[255,0,255]};this.underlayprops={color:[255,0,255]};}
    addUnderlay(_e,id){this.underlayVisible=!!id;}
    addOverlay(_e,id){if(id){this.rawOverlay={color:[77,77,77]};this.overlayprops=this.rawOverlay;this.shape.overlay=full;}}
  }
  const level0=new Array(66*66).fill({flags:0});
  level0[67]={flags:1,rest:{underlay:0,overlay:0}};
  level0[133]={flags:1,rest:{underlay:0,overlay:1}};
  const result=makeFloorGrid({x:71,z:52,nxttiles:{level0}}, {},
    {TileProps,HSL2RGB:()=>[0,0,0],packedHSL2HSL:n=>n});
  assert.equal(result.getTile(71*64,52*64,0).hasFloor,false);
  assert.equal(result.floor[0],0);
  assert.equal(result.getTile(71*64+1,52*64,0).hasFloor,true);
  assert.equal(result.floor[64],1);
});
