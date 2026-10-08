import {HpTracker,observerTrackerOptions,readHealthBar,hasHealthBarOutline,isFullHealthCapsule,fixedHealthRegions,recordedHealthRegions,readFixedObserverBar,readCapsuleWhiteFill,maskHealthCapsule,filterHealthFill} from './logic.mjs';
const $=id=>document.getElementById(id),video=$('video'),frame=$('frame'),ctx=frame.getContext('2d');
const sample=document.createElement('canvas'),sampleCtx=sample.getContext('2d',{willReadFrequently:true});
const slots=Array.from({length:10},(_,i)=>{
  const panel=document.createElement('section');panel.className='player-tile';panel.id=`panel${i}`;
  const title=document.createElement('button');title.id=`label${i}`;title.className='slot-button';title.onclick=()=>{active=i;$('inspect').value=String(i);showSelection();};
  const label=document.createElement('label');label.className='name-label';label.textContent='Exact player name ';
  const input=document.createElement('input');input.id=`name${i}`;input.placeholder='Unbound · preview only';label.append(input);
  const hp=document.createElement('output');hp.id=`hp${i}`;hp.className='tile-hp';hp.textContent='—';
  const canvas=document.createElement('canvas');canvas.id=`crop${i}`;canvas.className='playerCrop';
  const rawLabel=document.createElement('p');rawLabel.textContent='Raw shaped crop';
  const filteredLabel=document.createElement('p');filteredLabel.textContent='Fill candidates · white / low-health red';
  const filtered=document.createElement('canvas');filtered.id=`filtered${i}`;filtered.className='playerCrop';
  const quality=document.createElement('p');quality.id=`quality${i}`;quality.className='tile-quality';quality.textContent='Waiting for source';
  const details=document.createElement('div');details.id=`detail${i}`;details.className='slot-details';
  const raw=document.createElement('div'),fill=document.createElement('div');raw.append(rawLabel,canvas);filteredLabel.textContent='Detected fill';fill.append(filteredLabel,filtered);details.append(raw,fill);$('detailCache').append(details);
  panel.append(title,label,hp,quality);$('players').append(panel);
  return {roi:null,tracker:new HpTracker(observerTrackerOptions),name:'',enabled:true};
});
const enabledSlots=()=>slots.filter(s=>s.enabled);
const slotLabel=i=>$('layout').value==='recording'?`${i<5?'Left':'Right'} · slot ${i%5+1}`:`${i===0?'Left':'Right'} · slot 1`;
let stream,active=0,drag=null,running=false,busy=false,generation=0;
let sourceMode='capture',replayUrl=null,sourceReady=false;
const params=new URLSearchParams(location.search);$('group').value=params.get('groupCode')||'VLXEUROPE';
function updateLink(){const demo=$('group').value.trim().toUpperCase()==='HP-PREVIEW';$('overlay').href=demo?'/hp-reader/preview.html':`/overlay?groupCode=${encodeURIComponent($('group').value.trim().toUpperCase())}&hpReader=1`;$('overlay').textContent=demo?'Open HP demo ↗':'Open live HUD ↗';}
updateLink();
let remotePaired=false;
const bridgeUrl=()=>remotePaired?'/observer/hp':'http://127.0.0.1:5210/hp';
$('pair').onclick=async()=>{
  running=false;reset();remotePaired=false;
  try{
    const response=await fetch('/observer/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiver:$('receiver').value.trim(),token:$('pairKey').value.trim(),groupCode:$('group').value.trim().toUpperCase()}),signal:AbortSignal.timeout(5000)});
    if(!response.ok){let message='Use the standalone observer launcher to pair.';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
    remotePaired=true;$('pairKey').value='';$('forward').checked=true;$('pairStatus').textContent='Paired · bind names, select game window, then start readers.';
  }catch(e){$('pairStatus').textContent=e.message;}
};
const demoChannel=new BroadcastChannel('spectra-hp-demo');
setInterval(()=>{if($('group').value.trim().toUpperCase()==='HP-PREVIEW'&&sourceReady)demoChannel.postMessage({type:'playback',groupCode:'HP-PREVIEW',src:sourceMode==='replay'?video.getAttribute('src'):null,time:video.currentTime,paused:video.paused});},200);
async function send(slot,hp,group=$('group').value.trim().toUpperCase()) {
  if(params.has('desktop')&&!remotePaired)return;
  if(!$('forward').checked||!slot.name||enabledSlots().filter(s=>s.name.toLowerCase()===slot.name.toLowerCase()).length!==1)return;
  const response=await fetch(bridgeUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupCode:group,playerName:slot.name,hp,epoch:slot.lifecycle?.epoch}),signal:AbortSignal.timeout(remotePaired?3500:900)});
  if(response.status===409){slot.tracker.reset();return;}
  if(!response.ok)throw Error(`Bridge HTTP ${response.status}`);
}
function reset(){generation++;for(const [i,slot] of slots.entries()){slot.tracker.reset();$(`panel${i}`).classList.remove('is-stale');$(`hp${i}`).textContent='—';$(`quality${i}`).textContent='Waiting for reading';void send(slot,null).catch(()=>{});}$('detailQuality').textContent='Waiting for reading';}
function stop(){sourceReady=false;running=false;reset();stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();if(replayUrl)URL.revokeObjectURL(replayUrl);replayUrl=null;sourceMode='capture';video.hidden=true;video.controls=false;$('replayControls').hidden=true;$('replayStatus').textContent='';$('share').disabled=false;$('track').disabled=true;$('status').textContent='Source stopped.';}
$('stop').onclick=stop;
for(const [i,slot] of slots.entries())$(`name${i}`).onchange=()=>{running=false;reset();slot.name=$(`name${i}`).value.trim();$('status').textContent='Binding changed. Verify crops and start again.';};
$('group').onchange=()=>{running=false;reset();remotePaired=false;$('pairStatus').textContent='Group changed · pair again before remote forwarding.';updateLink();};
$('forward').onchange=reset;
function showSelection(){const r=slots[active].roi;$('editing').textContent=slotLabel(active);
  for(const [i] of slots.entries()){$(`panel${i}`).classList.toggle('is-selected',i===active);$(`label${i}`).setAttribute('aria-pressed',String(i===active));}
  for(const child of [...$('selectedDetails').children])$('detailCache').append(child);
  $('selectedDetails').append($(`detail${active}`));$('detailQuality').textContent=$(`quality${active}`).textContent;
  $('selection').style.display=r?'block':'none';if(r)Object.assign($('selection').style,{left:`${r.x/frame.width*100}%`,top:`${r.y/frame.height*100}%`,width:`${r.w/frame.width*100}%`,height:`${r.h/frame.height*100}%`});}
$('inspect').onchange=()=>{active=Number($('inspect').value);showSelection();};
function applyFixedRegions(){
  const recording=$('layout').value==='recording';
  const regions=(recording?recordedHealthRegions:fixedHealthRegions)(frame.width,frame.height);
  $('inspect').replaceChildren();
  for(const [i,slot] of slots.entries()){
    slot.enabled=recording||i<2;slot.roi=regions?.[i]?.outer||null;slot.inner=regions?.[i]?.inner||null;
    $(`panel${i}`).hidden=!slot.enabled;$(`label${i}`).textContent=slotLabel(i);$(`panel${i}`).classList.toggle('right',recording?i>=5:i===1);
    $(`panel${i}`).style.order=String(recording?(i%5)*2+(i<5?0:1):i);
    if(slot.enabled){const option=document.createElement('option');option.value=String(i);option.textContent=slotLabel(i);$('inspect').append(option);}
  }
  if(!slots[active].enabled)active=0;$('inspect').value=String(active);
  showSelection();$('track').disabled=!regions;
  $('status').textContent=regions?`${enabledSlots().length} fixed regions ready. Start readers.`:'Unsupported capture size. Select the Valorant game window.';
}
$('layout').onchange=()=>{running=false;reset();applyFixedRegions();if(!sourceReady)$('track').disabled=true;};
applyFixedRegions();$('track').disabled=true;$('status').textContent='Select a game window or load a recording. All ten fixed slots are ready.';
async function loadReplay(url,isObjectUrl=false){
  stop();sourceMode='replay';if(isObjectUrl)replayUrl=url;
  // Recorded players are different from the live roster. Preview locally until
  // the user intentionally supplies matching names and enables forwarding.
  $('forward').checked=false;$('layout').value='recording';
  video.hidden=false;video.controls=false;video.src=url;video.load();
  $('replayControls').hidden=false;video.loop=$('loopReplay').checked;
  $('replayStatus').textContent='Loading replay…';
  const token=generation;
  try{
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);clearTimeout(timeout);};
      const ready=()=>{cleanup();resolve();};
      const failed=()=>{cleanup();reject(Error('Browser cannot decode this video. Use the supplied MP4 or an H.264 MP4.'));};
      const timeout=setTimeout(()=>{cleanup();reject(Error('Video did not load. Check the file and preview server.'));},15000);
      video.addEventListener('loadeddata',ready,{once:true});video.addEventListener('error',failed,{once:true});
    });
    if(token!==generation)return;
    frame.width=video.videoWidth;frame.height=video.videoHeight;applyFixedRegions();sourceReady=true;running=enabledSlots().every(s=>s.roi);
    $('status').textContent=running?'Tracking all ten top bars. Unknown means the detector rejected the frame.':'Recording layout unavailable.';
    $('replayStatus').textContent=`Replay ready · ${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(1)} seconds. Play, pause or seek to inspect frames. Forwarding is off.`;
    await video.play();
  }catch(e){if(token===generation){running=false;$('replayStatus').textContent=e.message;}}
}
$('replay').onclick=()=>loadReplay('/hp-reader/replays/hp-test-2026-10-08.mp4');
$('demo').onclick=async()=>{
  try{
    const response=await fetch('/hp-reader/preview-roster.json');if(!response.ok)throw Error('Demo roster unavailable');const roster=await response.json();
    stop();$('group').value='HP-PREVIEW';updateLink();
    for(const [i,slot] of slots.entries()){slot.name=roster[i].name;$(`name${i}`).value=slot.name;slot.lifecycle=null;slot.spectraBlocked=false;}
    await loadReplay('/hp-reader/replays/hp-test-2026-10-08.mp4');
    if(sourceReady){$('forward').checked=true;$('status').textContent='Demo ready · open HP demo to see matching names, agents and reader HP. Isolated from your live group.';}
  }catch(e){$('status').textContent=e.message;}
};
$('replayFile').onchange=()=>{const file=$('replayFile').files[0];if(file)void loadReplay(URL.createObjectURL(file),true);$('replayFile').value='';};
video.addEventListener('seeking',()=>{if(sourceReady)reset();});
$('playReplay').onclick=()=>{if(sourceMode==='replay'){if(video.paused)void video.play().catch(e=>{$('replayStatus').textContent=e.message;});else video.pause();}};
$('restartReplay').onclick=()=>{if(sourceMode==='replay'){video.currentTime=0;void video.play().catch(e=>{$('replayStatus').textContent=e.message;});}};
$('loopReplay').onchange=()=>{video.loop=$('loopReplay').checked;};
const formatTime=seconds=>`${Math.floor((seconds||0)/60)}:${String(Math.floor((seconds||0)%60)).padStart(2,'0')}`;
function updatePlayback(){const duration=Number.isFinite(video.duration)?video.duration:0;$('seekReplay').max=String(duration||1);if(document.activeElement!==$('seekReplay'))$('seekReplay').value=String(video.currentTime||0);$('replayTime').textContent=`${formatTime(video.currentTime)} / ${formatTime(duration)}`;}
video.addEventListener('timeupdate',updatePlayback);video.addEventListener('loadedmetadata',updatePlayback);
$('seekReplay').oninput=()=>{if(sourceMode==='replay'&&sourceReady)video.currentTime=Number($('seekReplay').value);};
$('share').onclick=async()=>{stop();const token=generation;$('share').disabled=true;try{
  const chosen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:10,max:15}},audio:false});
  if(token!==generation){chosen.getTracks().forEach(t=>t.stop());return;}stream=chosen;video.srcObject=chosen;await video.play();
  frame.width=video.videoWidth;frame.height=video.videoHeight;applyFixedRegions();sourceReady=true;
  chosen.getVideoTracks()[0].addEventListener('ended',stop,{once:true});
}catch(e){stop();$('status').textContent=e.message;}};
$('track').onclick=()=>{if((!stream&&sourceMode!=='replay')||!enabledSlots().every(s=>s.roi))return;const names=enabledSlots().filter(s=>s.name).map(s=>s.name.toLowerCase());if(new Set(names).size!==names.length){$('status').textContent='Player bindings must be distinct; leave unbound slots blank.';return;}reset();running=true;$('status').textContent=`Tracking ${enabledSlots().length} top bars. Unbound slots are preview only.`;};
function read(slot,i){const r=slot.roi;sample.width=r.w;sample.height=r.h;sampleCtx.drawImage(frame,r.x,r.y,r.w,r.h,0,0,r.w,r.h);const pixels=sampleCtx.getImageData(0,0,r.w,r.h);
  const masked=maskHealthCapsule(pixels.data,r.w,r.h);
  const shaped=new ImageData(masked,r.w,r.h);sampleCtx.putImageData(shaped,0,0);
  const canvas=$(`crop${i}`);canvas.width=r.w*6;canvas.height=r.h*6;canvas.style.maxWidth='100%';const preview=canvas.getContext('2d');preview.imageSmoothingEnabled=false;preview.drawImage(sample,0,0,canvas.width,canvas.height);
  const filtered=$(`filtered${i}`);filtered.width=canvas.width;filtered.height=canvas.height;filtered.style.maxWidth='100%';
  sampleCtx.putImageData(new ImageData(filterHealthFill(pixels.data,r.w,r.h),r.w,r.h),0,0);
  const filteredCtx=filtered.getContext('2d');filteredCtx.imageSmoothingEnabled=false;filteredCtx.drawImage(sample,0,0,filtered.width,filtered.height);
  sampleCtx.putImageData(shaped,0,0);
  if($('layout').value==='recording')return readFixedObserverBar(pixels.data,r.w,r.h);
  // Full health uses the observed contour in the original crop to validate
  // presence; the fixed mask must not manufacture a capsule out of sky.
  if(isFullHealthCapsule(pixels.data,r.w,r.h))return 100;
  const partial=readCapsuleWhiteFill(masked,r.w,r.h,pixels.data);
  if(partial!==null)return partial;
  const inner=slot.inner;
  const strip=sampleCtx.getImageData(inner.x-r.x,inner.y-r.y,inner.w,inner.h);
  const pad=Math.max(4,inner.h),w=inner.w+2*pad,h=inner.h+2*pad;let outline=false;
  if(inner.x>=pad&&inner.y>=pad&&inner.x+inner.w+pad<=frame.width&&inner.y+inner.h+pad<=frame.height){sample.width=w;sample.height=h;sampleCtx.drawImage(frame,inner.x-pad,inner.y-pad,w,h,0,0,w,h);outline=hasHealthBarOutline(sampleCtx.getImageData(0,0,w,h).data,w,h,pad);}
  const fallback=readHealthBar(strip.data,inner.w,inner.h,190,outline);
  // White fill must pass the capsule transition fit above. The older strip
  // threshold can merge a pale track into the fill and produce a false 98.
  return fallback!==null&&fallback<=50?fallback:null;
}
async function syncLifecycle(){
  if(params.has('desktop')&&!remotePaired)throw Error('Connect to the broadcaster before starting readers.');
  if(!$('forward').checked||!enabledSlots().some(s=>s.name))return;
  const response=await fetch(`${bridgeUrl()}/state?groupCode=${encodeURIComponent($('group').value.trim().toUpperCase())}`,{cache:'no-store',signal:AbortSignal.timeout(remotePaired?3500:900)});
  if(!response.ok)throw Error('Spectra lifecycle sync unavailable');
  const state=await response.json();
  if(!state)throw Error('Open the linked live HUD to sync Spectra deaths and rounds.');
  for(const slot of enabledSlots()){
    const name=slot.name.toLowerCase(),matches=state?.players.filter(p=>p.name.toLowerCase()===name||p.fullName.toLowerCase()===name)||[];
    const player=matches.length===1?matches[0]:null;
    if(slot.lifecycle?.epoch!==player?.epoch)slot.tracker.reset();
    slot.lifecycle=player;slot.spectraBlocked=!!state&&(!player||!player.isAlive||!state.isRunning);
  }
}
async function tick(){if(!running||busy||drag||video.seeking||video.readyState<2)return;busy=true;const token=generation;
  try{await syncLifecycle();if(token!==generation)return;ctx.drawImage(video,0,0,frame.width,frame.height);const now=performance.now(),updates=[];
    for(const [i,slot] of slots.entries()){
      if(!slot.enabled)continue;
      if($('forward').checked&&slot.name&&slot.spectraBlocked){slot.tracker.reset();$(`panel${i}`).classList.remove('is-stale');$(`hp${i}`).textContent='—';$(`quality${i}`).textContent=slot.lifecycle?.isAlive===false?'Dead · confirmed by Spectra':'Waiting for a live Spectra player';continue;}
      const value=read(slot,i),hp=slot.tracker.observe(value===null?'':String(value),value===null?0:90,now);
      const confirmed=hp!==null&&slot.tracker.updated===now,stale=hp!==null&&!confirmed;
      $(`panel${i}`).classList.toggle('is-stale',stale);
      $(`hp${i}`).textContent=hp!==null?`≈ ${hp} HP`:'—';
      $(`quality${i}`).textContent=stale?`Stale · last confirmed ${((now-slot.tracker.updated)/1000).toFixed(1)}s ago`:confirmed?'Top-bar estimate; not an exact measurement':value===null?'Unknown — no reliable fill detected':`Confirming ${value} HP — waiting for nearby readings`;
      // Keep the last confirmed value on the HUD while this reader is active.
      // Bridge TTL is a session heartbeat, not measurement freshness; the
      // tracker timestamp stays unchanged and the reader marks held HP stale.
      // Stop/source/binding changes explicitly clear the bridge via reset().
      updates.push(send(slot,hp));
    }
    $('detailQuality').textContent=$(`quality${active}`).textContent;
    await Promise.all(updates);if(token===generation)$('bridge').textContent=$('forward').checked?(remotePaired?'Connected · readings sent to host HUD.':'Readings sent to local HUD.'):'Forwarding off.';
  }catch(e){if(token===generation)$('bridge').textContent=e.message;}finally{busy=false;}}
setInterval(tick,200);
function draw(){if(sourceReady&&(stream||sourceMode==='replay')&&video.readyState>=2){if(frame.width!==video.videoWidth||frame.height!==video.videoHeight){running=false;reset();frame.width=video.videoWidth;frame.height=video.videoHeight;applyFixedRegions();}ctx.drawImage(video,0,0,frame.width,frame.height);}for(const [i,s] of slots.entries())if(s.tracker.current(performance.now())===null)$(`hp${i}`).textContent='—';requestAnimationFrame(draw);}draw();
window.addEventListener('beforeunload',stop);
