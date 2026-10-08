import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {recordedHealthRegions,readFixedObserverBar} from '../public/hp-reader/logic.mjs';

const [ffmpeg,video]=process.argv.slice(2);
if(!ffmpeg||!video)throw Error('Usage: node scripts/measure-observer-replay.mjs <ffmpeg> <1920x1080 replay>');
// Decode only the top 100 rows, at the browser reader's five samples/second.
const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i',video,'-vf','fps=5,crop=1920:100:0:0','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:256*1024*1024});
if(result.status!==0)throw Error(result.stderr?.toString()||result.error?.message||'Decode failed');
const bytes=1920*100*4,frames=Math.floor(result.stdout.length/bytes);
const counts={strict:0,adaptive:0},perSlot=Array.from({length:10},()=>({strict:0,adaptive:0}));
const viper80=[];
for(let f=0;f<frames;f++)for(const [i,{outer:r}] of recordedHealthRegions(1920,1080).entries()) {
  const pixels=new Uint8ClampedArray(r.w*r.h*4);
  for(let y=0;y<r.h;y++){const start=f*bytes+((r.y+y)*1920+r.x)*4;pixels.set(result.stdout.subarray(start,start+r.w*4),y*r.w*4);}
  for(const mode of ['strict','adaptive'])if(readFixedObserverBar(pixels,r.w,r.h,{adaptive:mode==='adaptive'})!==null){counts[mode]++;perSlot[i][mode]++;}
  if(i===4&&f>=50&&f<=100)viper80.push({time:f/5,hp:readFixedObserverBar(pixels,r.w,r.h)});
}
const falseFull=viper80.filter(v=>v.hp===100),readable=viper80.filter(v=>v.hp!==null);
console.log(JSON.stringify({frames,totalSlotFrames:frames*10,counts,perSlot,viper80:{samples:viper80.length,readable:readable.length,falseFull,range:readable.length?[Math.min(...readable.map(v=>v.hp)),Math.max(...readable.map(v=>v.hp))]:null},note:'Availability only, not accuracy. Absent/dead bars correctly count as unknown.'},null,2));
assert.equal(falseFull.length,0,'Supplied replay: Viper 80-HP stretch (10–20s) must never return 100');
assert.ok(readable.length>=25,'The 80-HP regression must not pass by rejecting everything');
