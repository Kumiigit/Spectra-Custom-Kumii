const http = require('node:http');
const {randomUUID, randomBytes, timingSafeEqual} = require('node:crypto');
const net = require('node:net');
const HP_READING_TTL_MS = 5000;

function createHpBridge(options = {}) {
  let latest = null;
  const readings = new Map();
  const states = new Map();let epoch=0;const session=randomUUID();
  const readingKey=(group,name)=>JSON.stringify([group,name.toLowerCase()]);
  const matchingPlayer=(state,name)=>{const hits=state.players.filter(p=>p.name.toLowerCase()===name.toLowerCase()||p.fullName.toLowerCase()===name.toLowerCase());return hits.length===1?hits[0]:null;};
  const prune = () => { for(const [key,value] of readings) if(Date.now()-value.updatedAt>=HP_READING_TTL_MS) readings.delete(key); };
  return http.createServer((req, res) => {
    const remote = !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.localAddress);
    const url=new URL(req.url,'http://127.0.0.1');
    if(remote){
      const supplied=Buffer.from(req.headers.authorization||'');
      const expected=Buffer.from(`Bearer ${options.token||''}`);
      if(!options.token||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401).end('{"error":"Invalid pairing key"}');return;}
      if(!((url.pathname==='/hp'&&req.method==='POST')||(url.pathname==='/hp/state'&&req.method==='GET'))){res.writeHead(403).end('{}');return;}
      if(req.method==='GET'&&url.searchParams.get('groupCode')?.trim().toUpperCase()!==options.groupCode){res.writeHead(403).end('{}');return;}
    }
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      res.writeHead(403).end(); return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if(url.pathname==='/hp/pairing'&&req.method==='GET'){
      res.end(JSON.stringify(options.receiver?{receiver:options.receiver,groupCode:options.groupCode,key:options.token}:null));return;
    }
    if (req.url === '/hp/all' && req.method === 'GET') {
      prune();res.end(JSON.stringify([...readings.values()]));return;
    }
    if(url.pathname==='/hp/state'&&req.method==='GET'){
      res.end(JSON.stringify(states.get((url.searchParams.get('groupCode')||'').trim().toUpperCase())||null));return;
    }
    if (req.url !== '/hp' && req.url !== '/hp/state') { res.writeHead(404).end('{}'); return; }
    if (req.method === 'GET') {
      res.end(JSON.stringify(latest && Date.now() - latest.updatedAt < HP_READING_TTL_MS ? latest : null)); return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end('{}'); return; }
    let body = ''; let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > (req.url==='/hp/state'?16384:2048)) { tooLarge = true; res.writeHead(413).end('{}'); }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const data = JSON.parse(body);
        if(remote&&data.groupCode?.trim().toUpperCase()!==options.groupCode){res.writeHead(403).end('{}');return;}
        if(req.url==='/hp/state'){
          if(typeof data.groupCode!=='string'||!data.groupCode.trim()||data.groupCode.length>64||
            !Number.isInteger(data.roundNumber)||typeof data.roundPhase!=='string'||typeof data.map!=='string'||typeof data.isRunning!=='boolean'||
            !Array.isArray(data.players)||data.players.length>20||data.players.some(p=>typeof p.name!=='string'||!p.name.trim()||p.name.length>128||typeof p.fullName!=='string'||p.fullName.length>128||typeof p.isAlive!=='boolean'))throw Error();
          const group=data.groupCode.trim().toUpperCase(),previous=states.get(group);
          const roundChanged=!previous||previous.roundNumber!==data.roundNumber||previous.map!==data.map||previous.isRunning!==data.isRunning||
            (data.roundPhase==='shopping'&&previous.roundPhase!=='shopping');
          const players=data.players.map(p=>{
            const old=previous?.players.find(o=>o.name===p.name&&o.fullName===p.fullName);
            return {...p,epoch:!roundChanged&&old&&old.isAlive===p.isAlive?old.epoch:`${session}:${++epoch}`};
          });
          const state={groupCode:group,roundNumber:data.roundNumber,roundPhase:data.roundPhase,map:data.map,isRunning:data.isRunning,players};states.set(group,state);
          for(const [key,reading] of readings){if(reading.groupCode!==group)continue;const p=matchingPlayer(state,reading.playerName);if(!p||!p.isAlive||reading.epoch!==p.epoch)readings.delete(key);}
          if(latest?.groupCode===group&&!readings.has(readingKey(group,latest.playerName)))latest=null;
          res.end(JSON.stringify(state));return;
        }
        if (typeof data.groupCode !== 'string' || !data.groupCode.trim() || data.groupCode.length > 64 ||
            typeof data.playerName !== 'string' || !data.playerName.trim() || data.playerName.length > 128 ||
            !(data.hp === null || (Number.isInteger(data.hp) && data.hp >= 0 && data.hp <= 100))) throw Error();
        const group=data.groupCode.trim().toUpperCase(),state=states.get(group),player=state?matchingPlayer(state,data.playerName.trim()):null;
        // Once Spectra supplies lifecycle state, old in-flight heartbeats
        // cannot repopulate HP after a death, resurrection or new round.
        if(data.hp!==null&&state&&(!player||!player.isAlive||!state.isRunning||data.epoch!==player.epoch)){res.writeHead(409).end('{"error":"HP lifecycle changed"}');return;}
        latest = data.hp === null ? null : {groupCode:group,playerName:data.playerName.trim(),hp:data.hp,updatedAt:Date.now(),...(player?{epoch:player.epoch,roundNumber:state.roundNumber}: {})};
        prune();
        const key=JSON.stringify([data.groupCode.trim().toUpperCase(),data.playerName.trim().toLowerCase()]);
        if(latest) readings.set(key,latest); else readings.delete(key);
        if(readings.size>100)readings.delete(readings.keys().next().value);
        res.end('{"ok":true}');
      } catch { res.writeHead(400).end('{"error":"Invalid HP reading"}'); }
    });
  });
}
function startHpBridge() {
  const host=process.env.HP_VPN_HOST;
  const groupCode=(process.env.HP_PAIR_GROUP||'').trim().toUpperCase();
  if(host&&(!net.isIPv4(host)||host==='0.0.0.0'||host.startsWith('127.')||!groupCode))throw Error('Set HP_VPN_HOST to your VPN IPv4 and HP_PAIR_GROUP to your match group.');
  const token=host?randomBytes(24).toString('hex'):null;
  const options={token,groupCode,receiver:null};
  const bridge=createHpBridge(options);
  bridge.on('error',error=>console.error('HP bridge:',error.message));
  bridge.listen(5210,'127.0.0.1',()=>console.log('Local HP bridge: http://127.0.0.1:5210/hp'));
  if(host){
    const vpn=http.createServer(bridge.listeners('request')[0]);
    vpn.on('error',error=>{options.receiver=null;console.error('VPN HP receiver:',error.message);});
    vpn.listen(5211,host,()=>{options.receiver=`http://${host}:5211`;console.log(`OCR receiver: ${options.receiver}\nMatch group: ${groupCode}\nPairing key (share only with observer): ${token}`);});
    bridge.on('close',()=>vpn.close());
  }
  return bridge;
}
module.exports = { createHpBridge, startHpBridge };
if (require.main === module) {
  startHpBridge();
}
