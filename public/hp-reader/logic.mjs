// Shared by the browser prototype and its offline regression tests.
// One portrait per side, centered 16:9 gameplay (including ultrawide pillarbox).
// Reference capture: 3440x1440, left bar centered near x1414, y106.
export function fixedHealthRegions(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<640||height<360||width/height<1.7)return null;
  const scale=height/1440;
  const region=(x,y,w,h)=>({x:Math.round(x),y:Math.round(y),w:Math.max(2,Math.round(w)),h:Math.max(2,Math.round(h))});
  return [-1,1].map(side=>{
    const center=width/2+side*306*scale;
    return {outer:region(center-31*scale,98*scale,62*scale,16*scale),inner:region(center-26*scale,103*scale,52*scale,6*scale)};
  });
}

// Five fixed slots per side, in screen order (left to right within each team).
// Reference: native 1920x1080 observer HUD in the supplied recording.
export function recordedHealthRegions(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<640||height<360||width/height<1.7)return null;
  const scale=height/1080;
  const offset=(width-height*16/9)/2;
  const r=(x,y,w,h)=>({x:Math.round(offset+x*scale),y:Math.round(y*scale),w:Math.round(w*scale),h:Math.max(2,Math.round(h*scale))});
  return [470,536,602,668,734,1197,1261,1327,1393,1459].map(center=>({outer:r(center-24,75,48,14),inner:r(center-19,81,38,3)}));
}

// Fixed observer HUD: compare each centre column against the surrounding rows.
// This checks bar presence before classifying fill; uniform sky cannot pass.
// Pixels near anti-aliased rounded ends are excluded from the fill measurement.
export function healthFillClass(r,g,b,a=255,background=null) {
  if(a<=128)return 0;
  // Don't desaturate first: that would turn bright coloured scenery into fill.
  if(Math.min(r,g,b)>=230&&Math.max(r,g,b)-Math.min(r,g,b)<=12)return 1;
  if(r>=160&&r-g>=45&&r-b>=35)return 2;
  // White HUD fill can be slightly tinted by compositing. Test whether the
  // three channels move toward white by a similar opacity, relative to the
  // local background. A coloured track usually follows that background much
  // more strongly; don't just raise the global chroma tolerance.
  if(background&&Math.min(r,g,b)>=220&&Math.max(r,g,b)-Math.min(r,g,b)<=40) {
    const alpha=[r,g,b].map((v,c)=>(v-background[c])/Math.max(20,255-background[c]));
    const centre=c=>{const mean=c.reduce((a,b)=>a+b,0)/3;return c.map(v=>v-mean);};
    const hue=centre([r,g,b]),bgHue=centre(background),norm=c=>Math.hypot(...c);
    const aligned=norm(bgHue)>=8&&hue.reduce((s,v,c)=>s+v*bgHue[c],0)/(norm(hue)*norm(bgHue))>=.8;
    if(aligned&&alpha.every(v=>v>=.72&&v<=1.15)&&Math.max(...alpha)-Math.min(...alpha)<=.18)return 1;
  }
  return 0;
}

export function filterHealthFill(data,width,height) {
  const shaped=maskHealthCapsule(data,width,height),out=new Uint8ClampedArray(data.length);
  for(let i=0;i<out.length;i+=4){const x=i/4%width,kind=healthFillClass(...shaped.subarray(i,i+4),observerBackground(data,width,height,x));if(kind)out.set(kind===1?[255,255,255,255]:[255,80,80,255],i);}
  return out;
}

function observerBackground(data,width,height,x) {
  const bottom=((height-1)*width+x)*4;
  return [0,1,2].map(c=>(data[x*4+c]+data[bottom+c])/2);
}

// Locate the strongest sustained vertical fill-to-track edge. Plateau checks
// validate the edge, but no longer choose its position by whole-bar fit cost.
function rawObserverBoundary(data,width,height,start,end,ys,classify,kind) {
  const median=a=>{const sorted=[...a].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
  const n=end-start,edges=[];
  for(const y of ys) {
    const values=Array.from({length:n},(_,x)=>{const i=(y*width+start+x)*4;return kind===2?data[i]-(data[i+1]+data[i+2])/2:Math.min(data[i],data[i+1],data[i+2]);});
    let best=null;
    const gradient=x=>(values[x-2]+2*values[x-1]-2*values[x]-values[x+1])/4;
    // Exclude rounded-end AA pixels from fitting, but retain full bar width
    // for the reported fraction. Very small/near-full fills remain unknown.
    const cap=Math.max(4,Math.round(height*.43));
    for(let split=4;split<n-4;split++) {
      const left=values.slice(2,split),right=values.slice(split,n-2),a=median(left),b=median(right);
      if(a-b<(kind===2?25:12))continue;
      const before=median(values.slice(Math.max(2,split-3),split)),after=median(values.slice(split,Math.min(n-2,split+3)));
      if(before-after<8)continue;
      if(Math.abs(after-b)>8)continue; // A hole recovers, or an early edge still has fill to its right.
      if(values.slice(split,Math.min(n-2,split+4)).some((v,i,a)=>i>0&&v-a[i-1]>8))continue;
      const accepted=left.filter((_,x)=>classify(start+2+x,y)===kind).length/left.length;
      if(accepted<.65)continue;
      const strength=gradient(split);
      if(strength<3)continue;
      if(!best||strength>best.strength)best={split,strength};
    }
    if(best&&best.split<n-cap){
      // A soft edge spans several pixels. Its local gradient centroid gives
      // a subpixel endpoint without drifting toward the rounded track cap.
      let weighted=0,total=0;
      for(let x=Math.max(4,best.split-2);x<=Math.min(n-5,best.split+2);x++){
        const strength=gradient(x);if(strength<best.strength*.35)continue;
        weighted+=x*strength;total+=strength;
      }
      if(total&&weighted/total<n-cap)edges.push(weighted/total);
    }
  }
  const tolerance=Math.max(1, width/48);
  // A corrupt third row must not veto two agreeing rows, but two disagreeing
  // rows must never be averaged into an invented boundary.
  for(const edge of edges){const agreeing=edges.filter(v=>Math.abs(v-edge)<=tolerance);if(agreeing.length>=2)return Math.max(1,Math.min(99,Math.round(median(agreeing)/n*100)));}
  return null;
}

export function readFixedObserverBar(data,width,height,{adaptive=true}={}) {
  if(width<20||height<6||data.length!==width*height*4)return null;
  // Soft outline pixels are geometry only; strict neutral core pixels below
  // must independently confirm fill before this contour can mean full HP.
  const fullProfile={chroma:35,capWidth:.45,middleWidth:.6,contrast:8,coverage:.55,staggeredCaps:true,continuity:.90};
  const ys=[...new Set([.43,.5,.64].map(v=>Math.min(height-1,Math.floor(height*v))))];
  const classify=(x,y)=>{const i=(y*width+x)*4;return healthFillClass(...data.subarray(i,i+4),adaptive?observerBackground(data,width,height,x):null);};
  const levelAt=x=>ys.reduce((sum,y)=>{const i=(y*width+x)*4;return sum+Math.min(data[i],data[i+1],data[i+2]);},0)/ys.length;
  const plateau=(a,b)=>{let sum=0,n=0;for(let x=Math.floor(width*a);x<Math.ceil(width*b);x++){sum+=levelAt(x);n++;}return sum/n;};
  // A bright empty track can retain the capsule outline. Full health also
  // requires an even opaque plateau, not just the relaxed edge threshold.
  const evenFill=plateau(.22,.45)-plateau(.70,.75)<4;
  let neutral=0,total=0;
  for(const y of ys)for(let x=Math.ceil(width*.2);x<Math.floor(width*.75);x++){neutral+=classify(x,y)===1?1:0;total++;}
  const margin=Math.round(width*5/48),start=margin,end=width-margin;
  const light=(x,y)=>{const i=(y*width+x)*4;return Math.min(data[i],data[i+1],data[i+2]);};
  const white=[],red=[];let rim=0;
  for(let x=start;x<end;x++) {
    const colours=ys.map(y=>Array.from(data.subarray((y*width+x)*4,(y*width+x)*4+3)));
    const redColumn=ys.filter(y=>classify(x,y)===2).length>=Math.ceil(ys.length*2/3);
    const level=colours.reduce((s,c)=>s+(redColumn?c[0]:Math.min(...c)),0)/ys.length;
    const outside=redColumn?observerBackground(data,width,height,x)[0]:(light(x,0)+light(x,height-1))/2;
    if(level-outside>=8)rim++;
    white.push(ys.filter(y=>classify(x,y)===1).length>=Math.ceil(ys.length*2/3));
    red.push(redColumn);
  }
  const columns=red.some(Boolean)?red:white;
  // A damaged bar may have a darker track; confirm the band over its fill.
  if(rim/columns.length<.55)return null;
  const boundary=rawObserverBoundary(data,width,height,start,end,ys,classify,red.some(Boolean)?2:1);
  // The right-hand tail must independently look opaque. The old plateau
  // stopped before an 80%-HP endpoint and could call its bright track full.
  let opaqueTail=0,tailTotal=0;
  for(const y of ys)for(let x=Math.floor(width*.76);x<Math.ceil(width*.81);x++) {
    const i=(y*width+x)*4,bg=observerBackground(data,width,height,x);
    const alpha=[0,1,2].map(c=>(data[i+c]-bg[c])/Math.max(20,255-bg[c]));
    if(classify(x,y)===1&&alpha.every(a=>a>=.85&&a<=1.15))opaqueTail++;
    tailTotal++;
  }
  if(evenFill&&neutral/total>=.8&&opaqueTail/tailTotal>=.75&&[220,230].some(white=>isFullHealthCapsule(data,width,height,data,{...fullProfile,white})))return 100;
  return boundary;
}

export function digitMask(data, threshold = 190, maxChroma = 65) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    const value = lo >= threshold && hi - lo <= maxChroma && data[i + 3] > 128 ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = value;
    out[i + 3] = 255;
  }
  return out;
}

// Shape template measured within the fixed 62x16 region. Pixel centres outside
// the capsule are transparent and cannot contribute to fill classification.
export function maskHealthCapsule(data,width,height) {
  const out=new Uint8ClampedArray(data.length);
  const left=width*4/62,right=width*58/62,top=height*3.5/16,bottom=height*12.5/16;
  const radius=(bottom-top)/2,cy=(top+bottom)/2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const px=x+.5,py=y+.5;
    const cx=Math.max(left+radius,Math.min(right-radius,px));
    if(py>=top&&py<=bottom&&px>=left&&px<=right&&(px-cx)**2+(py-cy)**2<=radius**2) {
      const i=(y*width+x)*4;out.set(data.subarray(i,i+4),i);
    }
  }
  return out;
}

// Full health needs the complete capsule in the crop, including a small
// surrounding margin. A uniformly bright strip is never sufficient evidence.
export function isFullHealthCapsule(data,width,height,context=data,profile={}) {
  if(width<20||height<6||data.length!==width*height*4)return false;
  const capsule=maskHealthCapsule(data,width,height);
  const spans=[];
  for(let y=0;y<height;y++) {
    let left=width,right=-1,count=0;
    for(let x=0;x<width;x++) {
      const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      // Red scenery outside the bar cannot invalidate an otherwise full bar.
      if(capsule[i+3]>128&&r>160&&r-g>45&&r-b>35)return false;
      if(data[i+3]>128&&Math.min(r,g,b)>=(profile.white??240)&&Math.max(r,g,b)-Math.min(r,g,b)<=(profile.chroma??18)){left=Math.min(left,x);right=x;count++;}
    }
    spans.push({left,right,count,size:right-left+1});
  }
  // Anti-aliased caps lose several bright pixels at capture resolution.
  // Keep the cap rows so their curvature can still be verified.
  const rows=spans.map((s,y)=>({...s,y})).filter(s=>s.size>=width*(profile.capWidth??.65)&&s.count/s.size>(profile.continuity??.97));
  if(rows.length<2)return false;
  const first=rows[0],last=rows.at(-1),middle=rows[Math.floor(rows.length/2)];
  if(first.y<1||last.y>=height-1||last.y-first.y+1>height*.85||rows.length!==last.y-first.y+1)return false;
  if(middle.size<width*(profile.middleWidth??.75)||middle.size>width*.98)return false;
  // Rounded caps narrow at both ends near the upper/lower edges. A rectangle,
  // sky gradient or a partial fill with a vertical edge cannot pass this.
  const inset=Math.max(1,Math.round(width*.008));
  if(profile.staggeredCaps) {
    if(Math.max(first.left,last.left)<middle.left+inset||Math.min(first.right,last.right)>middle.right-inset)return false;
  } else if(![first,last].every(s=>s.left>=middle.left+inset&&s.right<=middle.right-inset))return false;
  const light=(x,y)=>{const i=(y*width+x)*4;return Math.min(context[i],context[i+1],context[i+2]);};
  let contrast=0,total=0;
  for(let x=first.left;x<=first.right;x++) {
    if(light(x,middle.y)-light(x,0)>=(profile.contrast??15)&&light(x,middle.y)-light(x,height-1)>=(profile.contrast??15))contrast++;
    total++;
  }
  return contrast/total>=(profile.coverage??.85);
}

// Crop must contain the INNER horizontal bar, excluding its rounded border.
// Missing/dark crops are unknown, never a fabricated death.
export function readCapsuleWhiteFill(data,width,height,context=data) {
  if(width<20||height<6||data.length!==width*height*4)return null;
  const start=Math.round(width*.065),end=width-start,rows=[];
  const light=(x,y)=>{const i=(y*width+x)*4;return Math.min(data[i],data[i+1],data[i+2]);};
  for(let y=Math.floor(height*.4);y<=Math.floor(height*.6);y++) {
    const levels=Array.from({length:end-start},(_,i)=>light(start+i,y));
    let split=-1,drop=0;
    for(let x=3;x<levels.length-3;x++) {
      const d=(levels[x-2]+levels[x-1]-levels[x]-levels[x+1])/2;
      if(d>drop){drop=d;split=x;}
    }
    if(split<0||drop<12)return null;
    const left=levels.slice(2,split-1),right=levels.slice(split+1,-2);
    if(!left.length||!right.length)return null;
    const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
    if(mean(left)<240||mean(left)-mean(right)<12||Math.max(...left)-Math.min(...left)>15||Math.max(...right)-Math.min(...right)>20)return null;
    let rim=0;
    for(let x=start+2;x<end-2;x++) {
      const top=x*4,bottom=((height-1)*width+x)*4;
      if(light(x,y)-Math.min(context[top],context[top+1],context[top+2])>12&&light(x,y)-Math.min(context[bottom],context[bottom+1],context[bottom+2])>12)rim++;
    }
    if(rim/(end-start-4)<.85)return null;
    rows.push(split/(end-start)*100);
  }
  if(Math.max(...rows)-Math.min(...rows)>4)return null;
  return Math.round(rows.reduce((a,b)=>a+b,0)/rows.length);
}

export function readHealthBar(data, width, height, threshold = 190, outlineConfirmed = false) {
  if (width < 12 || height < 2 || data.length !== width * height * 4) return null;
  const whiteColumns = [], redColumns = [];
  let trackPixels = 0;
  for (let x = 0; x < width; x++) {
    let whites = 0, reds = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const [r,g,b,a] = data.subarray(i,i+4);
      // The translucent empty track inherits sky colour. A permissive OCR
      // threshold is not evidence of opaque white HUD fill.
      const white = Math.min(r,g,b) >= Math.max(225,threshold) && Math.max(r,g,b)-Math.min(r,g,b) <= 18;
      const red = r >= 160 && r-g >= 45 && r-b >= 35;
      if (a > 128 && white) whites++;
      if (a > 128 && red) reds++;
      if (a > 128 && (red || (Math.min(r,g,b) >= 75 && Math.max(r,g,b)-Math.min(r,g,b) < 55))) trackPixels++;
    }
    whiteColumns.push(whites >= Math.ceil(height * .5));
    redColumns.push(reds >= Math.ceil(height * .5));
  }
  // At low HP the fill turns red, but the empty track can remain bright
  // enough to pass the white threshold. Never combine those two colours.
  const columns = redColumns.some(Boolean) ? redColumns : whiteColumns;
  if (trackPixels / (width*height) < .8) return null;
  if (!columns[0]) {
    // Empty is only meaningful when the surrounding bar is still detected.
    // Mixed/disconnected fill is a bad crop, not evidence of low health.
    return outlineConfirmed && !columns.some(Boolean) ? 1 : null;
  }
  let end = columns.indexOf(false);
  // An entirely bright crop is indistinguishable from a bright background
  // using this inner strip alone. Fail closed until full HP can be verified
  // against a numeric reading or a separately detected bar outline.
  if (end < 0) return null;
  // Reject disconnected bright patches rather than interpreting scenery as HP.
  if (columns.slice(end + 1).filter(Boolean).length > 1) return null;
  if (!redColumns.some(Boolean)) {
    const brightness = (from,to) => {
      let total=0;
      for(let y=0;y<height;y++)for(let x=from;x<to;x++) {
        const i=(y*width+x)*4;
        total+=Math.min(data[i],data[i+1],data[i+2]);
      }
      return total/((to-from)*height);
    };
    if(brightness(0,end)-brightness(end,width)<20) return null;
  }
  return Math.max(1, Math.min(100, Math.round(end / width * 100)));
}

// Inspect a padded crop around the selected inner strip. Require a dark rim
// above AND below it over most of its width, not just bright scenery.
export function hasHealthBarOutline(data, width, height, padding) {
  if (padding < 2 || width <= padding*2+8 || height <= padding*2+1) return false;
  const light=(x,y)=>{const i=(y*width+x)*4;return (data[i]+data[i+1]+data[i+2])/3;};
  let matched=0,total=0;
  for(let x=padding+2;x<width-padding-2;x++) {
    const middle=light(x,Math.floor(height/2));
    let top=false,bottom=false;
    for(let y=1;y<padding;y++) {
      const edge=light(x,y);
      if(middle-edge>18 && light(x,0)-edge>8)top=true;
      const other=light(x,height-1-y);
      if(middle-other>18 && light(x,height-1)-other>8)bottom=true;
    }
    if(top&&bottom)matched++;
    total++;
  }
  return total>0 && matched/total>=.8;
}

// A 38-pixel bar cannot reliably resolve single HP. Keep display hysteresis
// separate from the detector so genuine larger damage is still confirmed.
export const observerTrackerOptions=Object.freeze({tolerance:3,windowMs:1200,holdMs:Infinity,deadband:4,riseConfirmations:5});

export class HpTracker {
  constructor({tolerance=0,windowMs=800,holdMs=1500,deadband=0,riseConfirmations=2}={}) {
    this.tolerance=tolerance;this.windowMs=windowMs;this.holdMs=holdMs;
    this.deadband=deadband;this.riseConfirmations=riseConfirmations;this.reset();
  }
  reset() {
    this.candidate = null;
    this.count = 0;
    this.value = null;
    this.updated = -Infinity;
    this.samples=[];
  }
  observe(text, confidence, now) {
    const raw = text.trim();
    const number = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
    if(this.tolerance>0) {
      this.samples=this.samples.filter(s=>now-s.time<=this.windowMs);
      if(Number.isFinite(number)&&number<=100&&confidence>=45) {
        // A competing value breaks the run instead of leaving an older
        // cluster available to be reused when the detector flips back.
        const compatible=value=>(number===0||number===100||value===0||value===100)?value===number:Math.abs(value-number)<=this.tolerance;
        if(!this.samples.every(s=>compatible(s.value)))this.samples=[];
        this.samples.push({value:number,time:now});this.samples=this.samples.slice(-5);
        // The newest reading must agree with the cluster. An isolated 100
        // must never refresh a previous damaged-health estimate.
        let agreeing=this.samples;
        const previous=this.current(now),rising=previous!==null&&number>previous+this.deadband;
        // Healing needs independent evidence above the held value. Samples
        // inside its deadband cannot count toward an increase.
        if(rising)agreeing=agreeing.filter(s=>s.value>previous+this.deadband);
        if(agreeing.length>=(rising?this.riseConfirmations:2)) {
          const values=agreeing.map(s=>s.value).sort((a,b)=>a-b),mid=Math.floor(values.length/2);
          const estimate=Math.round(values.length%2?values[mid]:(values[mid-1]+values[mid])/2);
          // Anchor the deadband to the displayed value, not the last raw
          // sample: repeated tiny variations must not walk the display.
          const hold=previous!==null&&estimate!==0&&Math.abs(estimate-previous)<=this.deadband;
          this.value=hold?previous:estimate;this.updated=now;
        }
      } else this.samples=[]; // Missing/low-confidence frames break confirmation, not held HP.
      return this.current(now);
    }
    if (!Number.isFinite(number) || number > 100 || confidence < 45) {
      this.candidate = null;
      this.count = 0;
    } else {
      this.count = this.candidate === number ? this.count + 1 : 1;
      this.candidate = number;
      if (this.count >= 2) {
        this.value = number;
        this.updated = now;
      }
    }
    return this.current(now);
  }
  current(now) { return now - this.updated <= this.holdMs ? this.value : null; }
}
