import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {HpTracker,observerTrackerOptions,readFixedObserverBar} from '../public/hp-reader/logic.mjs';
const [ffmpeg,video]=process.argv.slice(2);
if(!ffmpeg||!video)throw Error('Usage: node scripts/analyze-hp-replay.mjs <ffmpeg> <video>');
const centers=[470,536,602,668,734,1197,1261,1327,1393,1459];
const labels=['Nova','Echo','Flux','Pixel','Orbit','Rift','Blaze','Ghost','Frost','Cipher'];
const fps=process.argv.includes('--phases')?60:5;
const filter=`[0:v]fps=${fps},format=rgba,split=10${centers.map((_,i)=>`[s${i}]`).join('')};`+
  centers.map((x,i)=>`[s${i}]crop=48:14:${x-24}:75[c${i}]`).join(';')+';'+
  centers.map((_,i)=>`[c${i}]`).join('')+'hstack=inputs=10[out]';
const result=spawnSync(ffmpeg,['-v','error','-i',video,'-filter_complex',filter,'-map','[out]','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:64*1024*1024});
if(result.status!==0)throw Error(result.stderr.toString());
const frameBytes=480*14*4,frames=Math.floor(result.stdout.length/frameBytes);
const raw=Array.from({length:10},()=>[]);
for(let f=0;f<frames;f++)for(let slot=0;slot<10;slot++){
  const pixels=new Uint8ClampedArray(48*14*4);
  for(let y=0;y<14;y++)pixels.set(result.stdout.subarray(f*frameBytes+(y*480+slot*48)*4,f*frameBytes+(y*480+slot*48+48)*4),y*48*4);
  raw[slot].push(readFixedObserverBar(pixels,48,14));
}
const evaluate=(options,phase=0)=>raw.map((values,i)=>{
  const tracker=new HpTracker(options),events=[],stable=[],stable50=[];let last=null,confirmed=0;
  values.forEach((value,f)=>{
    if(f%(fps/5)!==phase)return;
    const now=f/fps*1000,hp=tracker.observe(value===null?'':String(value),value===null?0:90,now);
    if(tracker.updated===now)confirmed++;
    if(hp!==null&&last!==null&&hp!==last)events.push({t:Number((f/fps).toFixed(2)),from:last,to:hp});
    if(hp!==null)last=hp;
    if(i===4&&f/fps>=10&&f/fps<20&&hp!==null)stable.push(hp);
    if(i===4&&f/fps>=21&&hp!==null)stable50.push(hp);
  });
  return {name:labels[i],changes:events.length,confirmed,events,...(i===4?{known80Range:stable.length?[Math.min(...stable),Math.max(...stable)]:null,known80Changes:events.filter(e=>e.t>=10&&e.t<20).length,known50Range:stable50.length?[Math.min(...stable50),Math.max(...stable50)]:null,known50Changes:events.filter(e=>e.t>=21).length}:{})};
});
const options=observerTrackerOptions;
if(fps===60){
  const phases=Array.from({length:12},(_,phase)=>evaluate(options,phase));
  for(const [i,phase] of phases.entries()){
    assert.equal(phase[4].known80Changes,0,`Stable 80-HP segment changed at sampling phase ${i}`);
    assert.ok(phase[4].known80Range&&phase[4].known80Range[0]>=76&&phase[4].known80Range[1]<=84,'Stability must not come from holding a wrong 100');
    assert.equal(phase[4].known50Changes,0,`Stable 50-HP end section changed at sampling phase ${i}`);
    assert.ok(phase[4].known50Range&&phase[4].known50Range[0]>=45&&phase[4].known50Range[1]<=55,'Real damage to 50 must remain detected, not frozen at 80');
  }
  console.log(JSON.stringify({seconds:frames/fps,samplingPhases:12,players:labels.map((name,i)=>({name,minChanges:Math.min(...phases.map(p=>p[i].changes)),maxChanges:Math.max(...phases.map(p=>p[i].changes)),...(i===4?{known80Ranges:phases.map(p=>p[i].known80Range),known80Changes:phases.map(p=>p[i].known80Changes),known50Ranges:phases.map(p=>p[i].known50Range),known50Changes:phases.map(p=>p[i].known50Changes)}:{})}))},null,2));
}else console.log(JSON.stringify({seconds:frames/fps,options:{...options,holdMs:'until reset'},players:evaluate(options)},null,2));
