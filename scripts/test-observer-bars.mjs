import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PNG} from 'pngjs';
import {recordedHealthRegions,readFixedObserverBar,healthFillClass,filterHealthFill} from '../public/hp-reader/logic.mjs';

for(const [w,h] of [[1920,1080],[2560,1440],[3440,1440],[1280,720]]) {
  const regions=recordedHealthRegions(w,h);
  assert.equal(regions.length,10);
  assert.equal(new Set(regions.map(r=>r.outer.x)).size,10);
  for(const {outer:r,inner} of regions){assert.ok(r.x>=0&&r.x+r.w<=w&&r.y+r.h<=h);assert.ok(inner.x>=r.x&&inner.x+inner.w<=r.x+r.w);}
}
assert.equal(recordedHealthRegions(400,300),null);
for(const colour of [[255,255,255],[225,235,245],[240,240,240],[40,40,40]]) {
  const pixels=new Uint8ClampedArray(48*14*4);
  for(let i=0;i<pixels.length;i+=4)pixels.set([...colour,255],i);
  assert.equal(readFixedObserverBar(pixels,48,14),null,'Uniform backgrounds must stay unknown');
}
console.log('PASS: ten distinct fixed slots, scaling and flat-background rejection');

assert.equal(healthFillClass(235,255,235),0,'Pale green is not neutral-white HP');
assert.equal(healthFillClass(240,240,255),0,'Pale blue is not neutral-white HP');
assert.equal(healthFillClass(245,246,244),1);
assert.equal(healthFillClass(240,80,85),2,'Genuine low-HP red is preserved');
assert.equal(healthFillClass(252,242,236,255,[91,69,57]),1,'Locally composited warm white fill is recovered');
assert.equal(healthFillClass(235,255,235,255,[80,80,80]),0,'Green hue unrelated to the local background is rejected');
assert.equal(healthFillClass(225,250,225,255,[190,240,190]),0,'Background-following green track is not opaque white fill');
function fixture(fill,colour=[245,245,245],skew=false) {
  const p=new Uint8ClampedArray(48*14*4);
  for(let y=0;y<14;y++)for(let x=0;x<48;x++){
    const split=5+fill+(skew?(y-7)*6:0);
    const c=y>=4&&y<=10&&x>=5&&x<43?(x<split?colour:[190,240,190]):[80,80,80];
    p.set([...c,255],(y*48+x)*4);
  }
  return p;
}
assert.equal(readFixedObserverBar(fixture(19),48,14),50,'Green empty track cannot count as fill');
assert.equal(readFixedObserverBar(fixture(19,[235,255,235]),48,14),null);
assert.equal(readFixedObserverBar(fixture(19,[245,245,245],true),48,14),null,'Inconsistent row boundaries are unknown');
const holes=fixture(19);
for(const y of [6,7,8])for(const x of [12,13])holes.set([120,120,120,255],(y*48+x)*4);
assert.equal(readFixedObserverBar(holes,48,14),50,'Short internal holes must not replace the true fill endpoint');
const colouredHoles=fixture(19);
for(const y of [6,7,8])for(const x of [12,13,14])colouredHoles.set([238,255,238,255],(y*48+x)*4);
assert.equal(readFixedObserverBar(colouredHoles,48,14),50,'Colour-filter gaps do not cut raw fill into lost HP');
assert.equal(readFixedObserverBar(fixture(10),48,14),26,'A real earlier empty section stays an earlier boundary');
assert.equal(readFixedObserverBar(fixture(19,[240,80,85]),48,14),50,'Red fill uses its raw colour transition');
for(const fill of [4,8,15,23,28])for(const colour of [[245,245,245],[240,80,85]]){
  const hp=readFixedObserverBar(fixture(fill,colour),48,14);
  assert.ok(hp!==null&&Math.abs(hp-fill/38*100)<=2,`Independent edge fixture ${fill}/38: ${hp}`);
}
for(const track of [[170,170,170],[205,185,165],[180,210,240]]){
  const pixels=fixture(23);
  for(let y=4;y<=10;y++)for(let x=28;x<43;x++)pixels.set([...track,255],(y*48+x)*4);
  const hp=readFixedObserverBar(pixels,48,14);
  assert.ok(hp!==null&&Math.abs(hp-23/38*100)<=2,`Track colour changes must not move the endpoint: ${hp}`);
}
assert.equal(readFixedObserverBar(fixture(34),48,14),null,'An edge in the rounded-cap zone is ambiguous, not a guessed smaller fill');
console.log('PASS: edge endpoints at multiple HP levels, red fill, varying track colours and cap rejection');
const roundedFull=new Uint8ClampedArray(48*14*4);
for(let y=0;y<14;y++)for(let x=0;x<48;x++){
  const inset=y===4||y===10?8:5,inside=y>=4&&y<=10&&x>=inset&&x<48-inset;
  roundedFull.set(inside?[245,245,245,255]:[80,80,80,255],(y*48+x)*4);
}
for(const y of [6,7,8])for(const x of [23,24])roundedFull.set([120,120,120,255],(y*48+x)*4);
assert.equal(readFixedObserverBar(roundedFull,48,14),100,'Small contour interruptions do not turn full HP into partial fill');
const brightEmptyTail=new Uint8ClampedArray(48*14*4);
for(let y=0;y<14;y++)for(let x=0;x<48;x++){
  const inset=y===4||y===10?8:5,inside=y>=4&&y<=10&&x>=inset&&x<48-inset;
  const v=inside?(x<36?245:235):210;
  brightEmptyTail.set([v,v,v,255],(y*48+x)*4);
}
assert.notEqual(readFixedObserverBar(brightEmptyTail,48,14),100,'Bright translucent tail cannot prove full health');
const filtered=filterHealthFill(fixture(19),48,14);
assert.equal(filtered[(7*48+12)*4+3],255);
assert.equal(filtered[(7*48+35)*4+3],0,'Coloured track disappears from candidate preview');
console.log('PASS: colour rejection, green track, distinct row checks and filtered preview');
console.log('PASS: raw-boundary fit tolerates small holes, preserves real endpoints and red fill');

// Optional frames extracted from the supplied replay, at 3 and 18 seconds.
// Use real pixels to exercise the same detector as the browser, not mock HP.
function readFrame(file) {
  const p=PNG.sync.read(fs.readFileSync(file));
  return recordedHealthRegions(p.width,p.height).map(({outer:r})=>{
    const pixels=new Uint8ClampedArray(r.w*r.h*4);
    for(let y=0;y<r.h;y++)pixels.set(p.data.subarray(((r.y+y)*p.width+r.x)*4,((r.y+y)*p.width+r.x+r.w)*4),y*r.w*4);
    return readFixedObserverBar(pixels,r.w,r.h);
  });
}
if(process.argv[2]) {
  const values=readFrame(process.argv[2]);
  assert.equal(values.length,10);
  for(const i of [0,1,2,3,4,5,6,7,9])assert.ok(values[i]===null||values[i]>=95&&values[i]<=100,`Full bar ${i}: ${values[i]}`);
  assert.equal(values[4],100,'Confirmed opaque full bar remains readable');
  assert.equal(values[0],100,'Tint-aware check recovers the genuinely full warm bar');
  assert.equal(values[8],null,'Absent portrait/bar must not fabricate health');
  console.log('PASS: replay 3s — warm and neutral fill recovered, absent slot unknown',values);
}
if(process.argv[3]) {
  const values=readFrame(process.argv[3]);
  assert.ok(values[4]>=74&&values[4]<=86,`Viper is visibly 80 HP; bar estimate: ${values[4]}`);
  for(const i of [6,7,8,9])assert.equal(values[i],null);
  console.log('PASS: replay 18s — damaged Viper is not 100; absent right slots unknown',values);
}
