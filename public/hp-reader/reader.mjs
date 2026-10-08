import { digitMask, HpTracker, readHealthBar, hasHealthBarOutline } from './logic.mjs';
const $ = (id) => document.getElementById(id);
const frame = $('frame'), crop = $('crop'), video = $('source');
const ctx = frame.getContext('2d'), cropCtx = crop.getContext('2d');
const raw = document.createElement('canvas'), rawCtx = raw.getContext('2d', {willReadFrequently:true});
const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
const outlineCanvas=document.createElement('canvas'), outlineCtx=outlineCanvas.getContext('2d',{willReadFrequently:true});
function barOutlineVisible() {
  const padding=Math.max(4,roi.h), w=roi.w+padding*2,h=roi.h+padding*2;
  if(roi.x<padding||roi.y<padding||roi.x+roi.w+padding>frame.width||roi.y+roi.h+padding>frame.height)return false;
  outlineCanvas.width=w;outlineCanvas.height=h;
  outlineCtx.drawImage(sourceFrame(),roi.x-padding,roi.y-padding,w,h,0,0,w,h);
  return hasHealthBarOutline(outlineCtx.getImageData(0,0,w,h).data,w,h,padding);
}
const tracker = new HpTracker();
let stream, still, worker, workerPromise, tracking = false, busy = false;
let generation = 0, lastValue = null, drag, roi = null, timer;
const status = (message) => { $('status').textContent = message; };
const params=new URLSearchParams(location.search);
$('groupCode').value=params.get('groupCode') || '';
$('playerName').value=params.get('playerName') || '';
$('mode').value=params.get('mode')==='bar'?'bar':'digits';
$('forward').checked=params.get('forward')==='1';
let presetPending=params.get('preset')==='viper';
function usePreset() {
  if (!sourceFrame()) { presetPending=true; status('Select the game window first. The Viper crop will be applied after capture starts.'); return; }
  $('mode').value='bar';
  const scale=frame.height/1440, left=(frame.width-2560*scale)/2;
  setRegion({x:left+948*scale,y:103*scale,w:52*scale,h:6*scale});
  status('Viper bar crop selected. Check the enlarged crop, then Start tracking. Reselect if portraits move.');
}
$('preset').onclick=usePreset;
$('mode').onchange=()=>{generation++;clearReading();if(roi&&sourceFrame())preprocess();};
function updateLink() {
  $('overlayLink').href=`/overlay?groupCode=${encodeURIComponent($('groupCode').value.trim().toUpperCase())}&hpReader=1`;
}
updateLink();
let bridgeBusy=false;
async function forwardHp(hp) {
  if (!$('forward').checked || bridgeBusy || still) return;
  const groupCode=$('groupCode').value.trim().toUpperCase(),playerName=$('playerName').value.trim();
  if (!groupCode || !playerName) { $('bridgeStatus').textContent='Enter the group code and exact player name first.'; return; }
  bridgeBusy=true;
  try {
    const response=await fetch('http://127.0.0.1:5210/hp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupCode,playerName,hp}),signal:AbortSignal.timeout(900)});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    $('bridgeStatus').textContent=hp===null?'No current reading. Overlay falls back to Spectra.':`Sent ${hp} HP → ${playerName} / ${groupCode}. Open the linked overlay to enable receiving.`;
  }catch(e){$('bridgeStatus').textContent=`HP bridge unavailable. Restart the preview server. (${e.message})`;}
  finally{bridgeBusy=false;}
}
for(const id of ['groupCode','playerName','forward']) $(id).onchange=()=>{updateLink();clearReading();if(!$('forward').checked)$('bridgeStatus').textContent='Forwarding off. Existing readings expire within 1.5 seconds.';};
function clearReading() { tracker.reset(); $('hp').textContent = '—'; lastValue = null; void forwardHp(null); }
function stop() {
  generation++; tracking = false; clearTimeout(timer);
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  still?.close?.(); still = null; video.srcObject = null;
  $('share').disabled = false; $('track').disabled = true; $('stop').disabled = true;
  clearReading(); status('Stopped. Capture released.');
}
function configure(width, height) {
  frame.width = width; frame.height = height; roi = null;
  $('selection').style.display = 'none'; $('track').disabled = true;
  $('stop').disabled = false; clearReading();
  status('Drag a tight rectangle around the HP digits, including space for three digits.');
  if(presetPending){presetPending=false;usePreset();}
}
function sourceFrame() {
  if (still) return still;
  return video.readyState >= 2 ? video : null;
}
function draw() {
  const source = sourceFrame();
  if (source) {
    if (!still && (video.videoWidth !== frame.width || video.videoHeight !== frame.height)) {
      tracking = false; generation++; configure(video.videoWidth, video.videoHeight);
      status('Capture resolution changed. Reselect the HP region and start again.');
    }
    ctx.drawImage(source, 0, 0, frame.width, frame.height);
  }
  if (tracker.current(performance.now()) === null) $('hp').textContent = '—';
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
function setRegion(r) {
  generation++; clearReading();
  const x = Math.max(0, Math.min(frame.width - 4, Math.round(r.x)));
  const y = Math.max(0, Math.min(frame.height - 4, Math.round(r.y)));
  roi = {x, y, w:Math.max(4,Math.min(frame.width-x,Math.round(r.w))), h:Math.max(4,Math.min(frame.height-y,Math.round(r.h)))};
  for (const key of ['x','y','w','h']) $(key).value = roi[key];
  Object.assign($('selection').style,{display:'block',left:`${x/frame.width*100}%`,top:`${y/frame.height*100}%`,width:`${roi.w/frame.width*100}%`,height:`${roi.h/frame.height*100}%`});
  $('track').disabled = !sourceFrame() || tracking;
  if (sourceFrame()) preprocess();
}
function position(e) {
  const rect = frame.getBoundingClientRect();
  return {x:Math.max(0,Math.min(frame.width,(e.clientX-rect.left)/rect.width*frame.width)),y:Math.max(0,Math.min(frame.height,(e.clientY-rect.top)/rect.height*frame.height))};
}
frame.onpointerdown = e => { if (!sourceFrame()) return; drag=position(e); frame.setPointerCapture(e.pointerId); };
frame.onpointermove = e => { if (!drag) return; const end=position(e); setRegion({x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),w:Math.abs(end.x-drag.x),h:Math.abs(end.y-drag.y)}); };
frame.onpointerup = frame.onpointercancel = () => { drag=null; };
for (const key of ['x','y','w','h']) $(key).onchange = () => {
  const r=Object.fromEntries(['x','y','w','h'].map(k=>[k,Number($(k).value)]));
  if (sourceFrame() && Object.values(r).every(Number.isFinite)) setRegion(r);
};
$('threshold').oninput = () => { $('thresholdValue').textContent=$('threshold').value; generation++; clearReading(); if(roi && sourceFrame()) preprocess(); };
function preprocess() {
  raw.width=roi.w; raw.height=roi.h;
  rawCtx.drawImage(sourceFrame(),roi.x,roi.y,roi.w,roi.h,0,0,roi.w,roi.h);
  const pixels=rawCtx.getImageData(0,0,roi.w,roi.h);
  if($('mode').value==='bar') {
    crop.width=roi.w*6;crop.height=roi.h*6;
    cropCtx.imageSmoothingEnabled=false;cropCtx.drawImage(raw,0,0,crop.width,crop.height);
    return pixels;
  }
  pixels.data.set(digitMask(pixels.data,Number($('threshold').value)));
  mask.width=roi.w; mask.height=roi.h; maskCtx.putImageData(pixels,0,0);
  const scale=Math.min(6,Math.max(3,100/roi.h));
  crop.width=Math.round(roi.w*scale)+40; crop.height=Math.round(roi.h*scale)+40;
  cropCtx.fillStyle='white'; cropCtx.fillRect(0,0,crop.width,crop.height);
  cropCtx.imageSmoothingEnabled=false; cropCtx.drawImage(mask,20,20,crop.width-40,crop.height-40);
}
async function getWorker() {
  if (!workerPromise) workerPromise=(async()=>{
    if (!window.Tesseract) throw new Error('OCR files not loaded. Restart the dev server and refresh.');
    status('Loading local OCR engine…');
    worker=await Tesseract.createWorker('eng',1,{workerPath:'/hp-reader/vendor/worker.min.js',corePath:'/hp-reader/vendor/core',langPath:'/hp-reader/vendor/lang'});
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE,user_defined_dpi:'300'});
    return worker;
  })().catch(e=>{workerPromise=null;throw e;});
  return workerPromise;
}
async function tick() {
  if (!tracking) return;
  if (busy || drag) { timer=setTimeout(tick,200); return; }
  busy=true; const current=generation;
  try {
    const barMode=$('mode').value==='bar';
    const ocr=barMode?null:await getWorker();
    if (!tracking || current!==generation || !sourceFrame()) return;
    const pixels=preprocess(); const start=performance.now();
    const estimated=barMode?readHealthBar(pixels.data,roi.w,roi.h,Number($('threshold').value),barOutlineVisible()):null;
    const {data}=barMode?{data:{text:estimated===null?'':String(estimated),confidence:estimated===null?0:90}}:await ocr.recognize(crop);
    if (!tracking || current!==generation) return;
    const now=performance.now();
    const hp=tracker.observe(data.text,data.confidence,now);
    // Never refresh the bridge with a cached reading after a rejected OCR frame.
    if(tracker.updated===now) void forwardHp(hp);
    else if(hp===null) void forwardHp(null);
    $('hp').textContent=hp===null?'—':String(hp);
    $('quality').textContent=barMode?`Bar estimate: ${data.text || 'unknown (no distinct fill edge)'} · about ${Math.ceil(100/roi.w)} HP per pixel · full/bright bars require numeric HP mode`:`Read: ${data.text.trim() || 'nothing'} · confidence ${Math.round(data.confidence)}% · ${Math.round(performance.now()-start)} ms`;
    status(hp===null?'Waiting for two matching, confident readings. Adjust the crop/threshold if needed.':'Tracking the selected HUD number. Enable forwarding above to update the overlay.');
    if (hp!==null && hp!==lastValue) {
      const li=document.createElement('li'); li.textContent=`${new Date().toLocaleTimeString()} → ${hp} HP`;
      $('history').prepend(li); while($('history').children.length>12) $('history').lastChild.remove(); lastValue=hp;
    }
  } catch(e) { tracking=false; clearReading(); $('track').disabled=!sourceFrame(); status(`Reader error: ${e.message}`); }
  finally { busy=false; if(tracking) timer=setTimeout(tick,200); }
}
$('track').onclick = () => { if(!roi || !sourceFrame()) return; tracking=true; $('track').disabled=true; clearTimeout(timer); tick(); };
$('stop').onclick=stop;
$('share').onclick=async()=>{
  stop(); $('share').disabled=true; const current=generation;
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Use Chrome or Edge at http://127.0.0.1:3000/hp-reader/index.html');
    const chosen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:10,max:15}},audio:false});
    if(current!==generation){chosen.getTracks().forEach(t=>t.stop());return;}
    stream=chosen; video.srcObject=stream; await video.play();
    configure(video.videoWidth,video.videoHeight);
    stream.getVideoTracks()[0].addEventListener('ended',stop,{once:true});
  } catch(e) { stop(); status(`Capture not started: ${e.message}`); }
};
$('file').onchange=async()=>{
  const file=$('file').files[0]; if(!file)return; stop();const current=generation;
  try {
    const image=await createImageBitmap(file);
    if(current!==generation){image.close();return;}
    still=image; configure(still.width,still.height); ctx.drawImage(still,0,0);
    setRegion({x:0,y:0,w:still.width,h:still.height});
    status('Image loaded. Crop to the HP number if needed, then Start tracking.');
  }catch(e){status(`Could not read image: ${e.message}`);}
  $('file').value='';
};
window.addEventListener('beforeunload',()=>{stop();worker?.terminate();});
