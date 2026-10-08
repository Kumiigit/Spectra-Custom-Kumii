const video=document.getElementById('video'),status=document.getElementById('status'),stage=document.getElementById('stage'),hud=document.querySelector('iframe');
new ResizeObserver(()=>{hud.style.transform=`scale(${stage.clientWidth/1920})`;}).observe(stage);
const channel=new BroadcastChannel('spectra-hp-demo');
channel.onmessage=async({data})=>{
  if(data.groupCode!=='HP-PREVIEW')return;
  if(data.type==='stop'){video.pause();status.textContent='Reader stopped';return;}
  if(data.type!=='playback')return;
  if(!data.src){status.textContent='Live capture · video backdrop unavailable';return;}
  if(video.getAttribute('src')!==data.src){video.src=data.src;video.load();}
  if(video.readyState>=2&&Math.abs(video.currentTime-data.time)>.25)video.currentTime=data.time;
  if(data.paused)video.pause();else if(video.paused)await video.play().catch(()=>{});
  status.textContent=data.paused?'Reader paused':'Synced to reader';
};
