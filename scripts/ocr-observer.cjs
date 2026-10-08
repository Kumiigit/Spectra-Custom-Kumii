// Dependency-free observer host. Run with Node.js; capture stays in a localhost browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
function createObserverHost(root=path.resolve(__dirname,'../public/hp-reader')) {
let connection=null;
const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,'http://localhost');
  // Only the locally hosted reader may configure or use this proxy.
  const authority=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==authority||(req.headers.origin&&req.headers.origin!==`http://${authority}`)){res.writeHead(403).end();return;}
  try{
    if(url.pathname==='/observer/connect'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048){res.writeHead(413).end();return;}}
      const data=JSON.parse(body),target=new URL(data.receiver);
      if(target.protocol!=='http:'||!net.isIPv4(target.hostname)||target.hostname==='0.0.0.0'||target.username||target.password||target.pathname!=='/'||target.search||target.hash||!target.port||!/^([a-f0-9]{48})$/.test(data.token))throw Error('Enter the receiver IPv4 address, port and pairing key shown on the host.');
      const next={url:target.origin,token:data.token,groupCode:String(data.groupCode||'').trim().toUpperCase()};
      const response=await fetch(`${next.url}/hp/state?groupCode=${encodeURIComponent(next.groupCode)}`,{headers:{Authorization:`Bearer ${next.token}`},signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw Error(`Receiver rejected pairing (HTTP ${response.status})`);
      const state=await response.json();if(!state)throw Error('Host must open the live HUD first, with hpReader=1.');
      connection=next;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;
    }
    if(url.pathname==='/observer/hp'||url.pathname==='/observer/hp/state'){
      if(!connection)throw Error('Pair with the host first.');
      const state=url.pathname.endsWith('/state');
      if((state&&req.method!=='GET')||(!state&&req.method!=='POST')){res.writeHead(405).end();return;}
      let body='';if(!state)for await(const chunk of req){body+=chunk;if(body.length>2048){res.writeHead(413).end();return;}}
      const response=await fetch(`${connection.url}/hp${state?`/state?groupCode=${encodeURIComponent(connection.groupCode)}`:''}`,{method:req.method,headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(state?{}:{body}),signal:AbortSignal.timeout(3000)});
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    const name=url.pathname==='/'?'dual.html':url.pathname.replace(/^\/hp-reader\//,'');
    const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!types[path.extname(file)]||req.method!=='GET'){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]);fs.createReadStream(file).on('error',()=>{if(!res.headersSent)res.writeHead(404);res.end();}).pipe(res);
  }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
return server;
}
module.exports={createObserverHost};
if(require.main===module){
const server=createObserverHost();
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(5212,'127.0.0.1',()=>console.log('Open http://127.0.0.1:5212/hp-reader/dual.html in Chrome or Edge. Keep this window open.'));
}
