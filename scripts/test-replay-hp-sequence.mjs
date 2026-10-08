import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFixedObserverBar} from '../public/hp-reader/logic.mjs';
const [ffmpeg,video]=process.argv.slice(2);
if(!ffmpeg||!video)throw Error('Usage: node scripts/test-replay-hp-sequence.mjs <ffmpeg> <supplied replay>');
// Viper remains on 80 HP during 10–20s. Decode every source frame, not only
// browser sampling intervals. Convert before crop to preserve odd y=75.
const decoded=spawnSync(ffmpeg,['-v','error','-ss','10','-i',video,'-t','10','-vf','format=rgba,crop=48:14:710:75','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:16*1024*1024});
if(decoded.status!==0)throw Error(decoded.stderr?.toString()||'Decode failed');
const bytes=48*14*4,total=Math.floor(decoded.stdout.length/bytes),readings=[],falseFull=[];
for(let f=0;f<total;f++){
  const hp=readFixedObserverBar(decoded.stdout.subarray(f*bytes,(f+1)*bytes),48,14);
  if(hp!==null)readings.push(hp);
  if(hp===100)falseFull.push(f);
}
console.log({total,readable:readings.length,falseFull:falseFull.length,range:readings.length?[Math.min(...readings),Math.max(...readings)]:null});
assert.ok(total>=590,'Expected the entire 60fps ten-second interval');
assert.equal(falseFull.length,0,`80-HP frames falsely called full: ${falseFull.slice(0,20).join(',')}`);
assert.ok(readings.length>=total*.5,'Cannot pass by rejecting most of the interval');
assert.ok(readings.every(hp=>hp>=76&&hp<=84),'Known 80-HP movement must stay within four estimated HP');
