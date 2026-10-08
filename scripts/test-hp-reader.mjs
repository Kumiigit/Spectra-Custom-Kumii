import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createWorker, PSM } from 'tesseract.js';
import { digitMask, HpTracker, observerTrackerOptions, readHealthBar, hasHealthBarOutline, isFullHealthCapsule, fixedHealthRegions, readCapsuleWhiteFill, maskHealthCapsule } from '../public/hp-reader/logic.mjs';

for(const [fill,empty] of [[.87,230],[.59,190]]) {
  const d=new Uint8ClampedArray(62*16*4),split=4+Math.round(54*fill);
  for(let y=0;y<16;y++)for(let x=0;x<62;x++) {
    const value=y>=4&&y<=11&&x>=4&&x<58?(x<split?250:empty):150;
    d.set([value,value,value,255],(y*62+x)*4);
  }
  assert.ok(Math.abs(readCapsuleWhiteFill(d,62,16)-fill*100)<=2);
  const shaped=maskHealthCapsule(d,62,16);
  assert.equal(shaped[3],0,'Background outside the capsule is transparent');
  assert.equal(shaped[(8*62+30)*4+3],255,'Bar interior remains available');
  assert.ok(Math.abs(readCapsuleWhiteFill(shaped,62,16,d)-fill*100)<=2);
  // Changes to excluded corners cannot change a fill estimate.
  const changed=d.slice();changed.set([255,0,0,255],0);
  assert.deepEqual(maskHealthCapsule(changed,62,16),shaped);
  d.fill(250);assert.equal(readCapsuleWhiteFill(d,62,16),null);
}
console.log('PASS: bright/dark empty-track transitions and flat-background rejection');

assert.equal(fixedHealthRegions(500,300),null);
assert.equal(fixedHealthRegions(1440,2560),null);
assert.deepEqual(fixedHealthRegions(3440,1440)[0].inner,{x:1388,y:103,w:52,h:6});
for(const [width,height] of [[3440,1440],[2560,1440],[1920,1080],[1280,720]]) {
  const regions=fixedHealthRegions(width,height);
  assert.ok(Math.abs(regions[0].outer.x+regions[1].outer.x+regions[0].outer.w-width)<=1);
  for(const {inner,outer} of regions) {
    assert.ok(inner.x>=outer.x&&inner.y>=outer.y);
    assert.ok(inner.x+inner.w<=outer.x+outer.w&&inner.y+inner.h<=outer.y+outer.h);
    assert.ok(outer.x>=0&&outer.x+outer.w<=width);
  }
}
console.log('PASS: fixed left/right positions and resolution scaling');

const capsule=new Uint8ClampedArray(64*16*4);
for(let y=0;y<16;y++)for(let x=0;x<64;x++) {
  const inset=y===3||y===11?5:y===4||y===10?3:2;
  const value=y>=3&&y<=11&&x>=inset&&x<64-inset?250:180;
  capsule.set([value,value,value,255],(y*64+x)*4);
}
assert.equal(isFullHealthCapsule(capsule,64,16),true);
for(const color of [[255,255,255],[220,235,250],[245,248,250]]) {
  const flat=new Uint8ClampedArray(64*16*4);
  for(let i=0;i<flat.length;i+=4)flat.set([...color,255],i);
  assert.equal(isFullHealthCapsule(flat,64,16),false);
}
const rectangle=new Uint8ClampedArray(capsule.length);
for(let y=0;y<16;y++)for(let x=0;x<64;x++) {
  const value=y>=3&&y<=11&&x>=2&&x<62?250:180;
  rectangle.set([value,value,value,255],(y*64+x)*4);
}
assert.equal(isFullHealthCapsule(rectangle,64,16),false);
const redCapsule=capsule.slice();redCapsule.set([245,80,80,255],(8*64+10)*4);
assert.equal(isFullHealthCapsule(redCapsule,64,16),false);
// Capture scaling softens the caps and narrows the opaque white centre.
const softCapsule=new Uint8ClampedArray(62*16*4);
for(let y=0;y<16;y++)for(let x=0;x<62;x++) {
  const inset=y===4||y===11?9:y===5||y===10?7:y===6||y===9?6:5;
  const white=y>=4&&y<=11&&x>=inset&&x<=60-inset;
  softCapsule.set(white?[249,248,245,255]:[120,80,60,255],(y*62+x)*4);
}
assert.equal(isFullHealthCapsule(softCapsule,62,16),true,'Soft rounded ends must not reject full health');
const damagedSoft=softCapsule.slice();
for(let y=4;y<=11;y++)for(let x=35;x<58;x++)damagedSoft.set([180,178,175,255],(y*62+x)*4);
assert.equal(isFullHealthCapsule(damagedSoft,62,16),false,'Partial fill must not become full health');
console.log('PASS: full capsule, flat sky, rectangle and damaged red capsule');

function barFixture(fill, colour=[245,245,245], background=[145,145,145]) {
  const data=new Uint8ClampedArray(100*4*4);
  for(let y=0;y<4;y++)for(let x=0;x<100;x++)data.set([...(x<fill?colour:background),255],(y*100+x)*4);
  return data;
}
assert.equal(readHealthBar(barFixture(54),100,4),54);
assert.equal(readHealthBar(barFixture(39,[230,80,85]),100,4),39);
for(const threshold of [120,185,190,245]) {
  assert.equal(readHealthBar(barFixture(39,[240,90,90],[230,232,238]),100,4,threshold),39,
    'Bright empty track must not count as health when the fill is red');
}
assert.equal(readHealthBar(barFixture(100),100,4),null,'Uniform bright crops cannot prove full HP');
for(const sky of [[200,220,240],[225,235,245],[235,240,245],[255,255,255]]) {
  assert.equal(readHealthBar(barFixture(100,sky),100,4,120),null,'Sky must never become full health');
}
assert.equal(readHealthBar(barFixture(54,[245,245,245],[232,232,232]),100,4),null,'Low contrast is ambiguous');
assert.equal(readHealthBar(barFixture(0),100,4),null);
assert.equal(readHealthBar(barFixture(0),100,4,190,true),1);
assert.equal(readHealthBar(barFixture(100),100,4,190,true),null,'Outline alone cannot distinguish full white from bright empty');
assert.equal(readHealthBar(new Uint8ClampedArray(1600),100,4,190,true),null);
const rim=new Uint8ClampedArray(32*12*4);
for(let y=0;y<12;y++)for(let x=0;x<32;x++) {
  const v=y===2||y===9?80:150;rim.set([v,v,v,255],(y*32+x)*4);
}
assert.equal(hasHealthBarOutline(rim,32,12,4),true);
rim.fill(240);
assert.equal(hasHealthBarOutline(rim,32,12,4),false);
assert.equal(readHealthBar(new Uint8ClampedArray(1600),100,4),null);
const interrupted=barFixture(39);interrupted.set([255,255,255,255],(2*100+80)*4);
assert.equal(readHealthBar(interrupted,100,4),39);
console.log('PASS: white/red partial bars, sky rejection, ambiguous full bars, missing bar and noise');

const tracker = new HpTracker();
assert.equal(tracker.observe('36',90,0),null);
assert.equal(tracker.observe('36',90,200),36);
assert.equal(tracker.observe('',90,400),36);
assert.equal(tracker.current(1800),null);
assert.equal(tracker.observe('0',90,1900),null);
assert.equal(tracker.observe('0',90,2100),0);
tracker.reset();
for (const text of ['101','150','-1','3 6','HP36','']) assert.equal(tracker.observe(text,90,0),null);
assert.equal(tracker.observe('36',0,0),null);
assert.equal(tracker.observe('36',0,200),null);
assert.deepEqual([...digitMask(new Uint8ClampedArray([255,255,255,255,0,200,255,255]))],[0,0,0,255,255,255,255,255]);
console.log('PASS: range validation, repeated readings, low confidence, zero HP, expiry and digit mask');

const movingTracker=new HpTracker({tolerance:3,windowMs:800,holdMs:2500});
assert.equal(movingTracker.observe('35',90,0),null);
assert.equal(movingTracker.observe('36',90,200),36,'Nearby readings should confirm');
assert.equal(movingTracker.observe('35',90,400),35,'Median should suppress one-pixel jitter');
assert.equal(movingTracker.observe('',0,600),35,'Brief missing frame should hold HP');
assert.equal(movingTracker.updated,400,'Missing frame must not refresh freshness');
assert.equal(movingTracker.observe('100',90,800),35,'Isolated full HP must not replace damaged HP');
assert.equal(movingTracker.updated,400,'Outlier must not refresh the bridge');
assert.equal(movingTracker.observe('34',90,1000),35,'Hold confirmed HP while a new run starts');
assert.equal(movingTracker.updated,400,'A reading after a competing sample cannot reuse an old run');
assert.equal(movingTracker.current(3501),null,'Held readings must expire');
assert.equal(movingTracker.observe('10',90,3600),null);
assert.equal(movingTracker.observe('11',90,3800),11,'Real damage needs only two nearby new samples');
movingTracker.reset();
assert.equal(movingTracker.observe('99',90,0),null);
assert.equal(movingTracker.observe('100',90,200),null,'Do not round near-full readings into confirmed 100');
assert.equal(movingTracker.observe('100',90,400),100);
movingTracker.reset();
assert.equal(movingTracker.observe('35',90,0),null);
assert.equal(movingTracker.observe('36',90,1000),null,'Old samples cannot confirm a fresh reading');
assert.equal(movingTracker.observe('36',0,1100),null,'Low-confidence samples cannot confirm');
console.log('PASS: motion jitter, gaps, stale expiry, outlier rejection and damage recovery');

const stableTracker=new HpTracker({tolerance:3,windowMs:800,holdMs:2500,deadband:3,riseConfirmations:3});
assert.equal(stableTracker.observe('84',90,0),null);
assert.equal(stableTracker.observe('84',90,200),84);
assert.equal(stableTracker.observe('86',90,400),84,'Small rise must keep the displayed HP');
assert.equal(stableTracker.observe('75',90,600),84,'One damage sample must not jump');
assert.equal(stableTracker.observe('75',90,800),75,'Two damage samples must update without animation delay');
assert.equal(stableTracker.observe('77',90,1000),75);
assert.equal(stableTracker.observe('74',90,1200),75,'Small falls must also stay inside the anchored deadband');
assert.equal(stableTracker.updated,1200,'Nearby confirmed readings must still refresh freshness');
assert.equal(stableTracker.observe('90',90,1400),75);
assert.equal(stableTracker.observe('91',90,1600),75,'Two healing samples are insufficient');
assert.equal(stableTracker.observe('90',90,1800),90,'Three nearby healing samples must update');
assert.equal(stableTracker.observe('100',90,2000),90);
assert.equal(stableTracker.observe('100',90,2200),90,'Full-health increases need stronger confirmation too');
assert.equal(stableTracker.observe('100',90,2400),100);
assert.equal(stableTracker.observe('',0,2600),100);
assert.equal(stableTracker.updated,2400,'Holding HP must not renew stale evidence');
assert.equal(stableTracker.current(4901),null);
assert.equal(stableTracker.observe('80',90,5000),null);
assert.equal(stableTracker.observe('80',90,5200),80,'Expired estimates must reacquire without an old deadband');
stableTracker.reset();
assert.equal(stableTracker.observe('1',90,0),null);
assert.equal(stableTracker.observe('1',90,200),1);
assert.equal(stableTracker.observe('0',90,400),1);
assert.equal(stableTracker.observe('0',90,600),0,'Confirmed zero must not be hidden by the deadband');
console.log('PASS: anchored display deadband, confirmed damage, stronger healing, freshness and reacquisition');

const heldTracker=new HpTracker({tolerance:3,windowMs:800,holdMs:Infinity,deadband:3,riseConfirmations:3});
assert.equal(heldTracker.observe('100',90,0),null);
assert.equal(heldTracker.observe('100',90,200),100);
for(const time of [400,3000,10000,60000])assert.equal(heldTracker.observe('',0,time),100,'No data must retain last confirmed HP');
assert.equal(heldTracker.updated,200,'Holding indefinitely must not pretend a new measurement occurred');
assert.equal(heldTracker.observe('75',90,60200),100);
assert.equal(heldTracker.observe('75',90,60400),75,'Fresh confirmed damage replaces held HP');
assert.equal(heldTracker.observe('',0,120000),75);
assert.equal(heldTracker.observe('90',90,120200),75);
assert.equal(heldTracker.observe('90',90,120400),75);
assert.equal(heldTracker.observe('90',90,120600),90,'Healing still needs three readings after a long gap');
heldTracker.reset();
assert.equal(heldTracker.current(120800),null,'Explicit reset must clear held HP');
console.log('PASS: indefinite last-confirmed HP, unchanged measurement age, replacement and reset');

const consecutiveTracker=new HpTracker({tolerance:3,windowMs:800,holdMs:Infinity,deadband:3,riseConfirmations:3});
assert.equal(consecutiveTracker.observe('87',90,0),null);
assert.equal(consecutiveTracker.observe('87',90,200),87);
for(const [i,hp] of [100,87,100,87,100,87].entries()){
  assert.equal(consecutiveTracker.observe(String(hp),90,400+i*200),87,'Alternating values must never recycle old confirmations');
  assert.equal(consecutiveTracker.updated,200,'An alternating run must remain stale');
}
assert.equal(consecutiveTracker.observe('100',90,1600),87);
assert.equal(consecutiveTracker.observe('100',90,1800),87);
assert.equal(consecutiveTracker.observe('100',90,2000),100,'Three consecutive increase readings should still work');
assert.equal(consecutiveTracker.observe('75',90,2200),100);
assert.equal(consecutiveTracker.observe('',0,2400),100);
assert.equal(consecutiveTracker.observe('75',90,2600),100,'Missing frame breaks an unconfirmed change');
assert.equal(consecutiveTracker.observe('76',90,2800),76,'Two consecutive nearby damage readings should work');
consecutiveTracker.reset();
assert.equal(consecutiveTracker.observe('35',90,0),null);
assert.equal(consecutiveTracker.observe('36',0,200),null);
assert.equal(consecutiveTracker.observe('36',90,400),null,'Low confidence breaks acquisition too');
assert.equal(consecutiveTracker.observe('35',90,600),36);
console.log('PASS: consecutive confirmations, alternating-value rejection and interrupted-run reset');

const deployedTracker=new HpTracker(observerTrackerOptions);
deployedTracker.observe('80',90,0);assert.equal(deployedTracker.observe('80',90,200),80);
for(const [i,value] of [76,76,76,80,80,80,84,84,84].entries())assert.equal(deployedTracker.observe(String(value),90,400+i*200),80,'Four-HP jitter must not move the display');
assert.equal(deployedTracker.observe('65',90,2200),80);
assert.equal(deployedTracker.observe('65',90,2400),65,'Real larger damage must still update in two samples');
assert.equal(deployedTracker.observe('80',90,2600),65);
assert.equal(deployedTracker.observe('80',90,2800),65);
assert.equal(deployedTracker.observe('80',90,3000),65);
assert.equal(deployedTracker.observe('80',90,3200),65);
assert.equal(deployedTracker.observe('80',90,3400),80,'Healing must still update with five consecutive samples');
console.log('PASS: deployed settings suppress four-HP jitter without freezing damage or healing');
deployedTracker.reset();
deployedTracker.observe('53',90,0);assert.equal(deployedTracker.observe('53',90,200),53);
for(const time of [400,600,800,1000])assert.equal(deployedTracker.observe('59',90,time),53,'Short false-healing runs must not replace held HP');
assert.equal(deployedTracker.observe('',0,1200),53);
assert.equal(deployedTracker.observe('59',90,1400),53,'A gap must restart stronger healing confirmation');
assert.equal(deployedTracker.updated,200);
console.log('PASS: end-of-clip false-healing regression');

// Optional local fixture: node scripts/test-hp-reader.mjs <cropped-hp.png> <expected>
if (process.argv[2]) {
  const src=PNG.sync.read(fs.readFileSync(process.argv[2]));
  const pixels=digitMask(src.data);
  const scale=Math.min(6,Math.max(3,100/src.height));
  const width=Math.round(src.width*scale),height=Math.round(src.height*scale);
  const out=new PNG({width:width+40,height:height+40});out.data.fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const from=(Math.min(src.height-1,Math.floor(y/height*src.height))*src.width+Math.min(src.width-1,Math.floor(x/width*src.width)))*4;
    const to=((y+20)*out.width+x+20)*4;
    for(let c=0;c<4;c++)out.data[to+c]=pixels[from+c];
  }
  const worker=await createWorker('eng',1,{langPath:path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'),cacheMethod:'none'});
  try {
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:PSM.SINGLE_LINE,user_defined_dpi:'300'});
    const {data}=await worker.recognize(PNG.sync.write(out));
    console.log({text:data.text.trim(),confidence:data.confidence});
    assert.equal(data.text.trim(),process.argv[3]);
    assert.ok(data.confidence>=45,'Sample must pass the same confidence gate as live tracking');
    console.log('PASS: supplied HP image');
  } finally {await worker.terminate();}
}
