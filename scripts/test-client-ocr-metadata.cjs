const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {EventEmitter}=require('node:events');
const {createHpBridge}=require('./hp-bridge.cjs');
const clientSource=process.argv[2]||require('node:path').resolve(__dirname,'../../Spectra-Client/src/main.ts');
if(!fs.existsSync(clientSource)){console.log('SKIP: optional Spectra desktop source not present; pass its main.ts path to run this integration test.');process.exit(0);}
const source=fs.readFileSync(clientSource,'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['publishOverlayPreviewStatus','refreshOcrPairing','startOverlayPreview'];
const extracted=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
(async()=>{
  const pairing={receiver:'http://26.1.2.3:5211',groupCode:'TEST',key:'a'.repeat(48)};
  const server=createHpBridge({receiver:pairing.receiver,groupCode:pairing.groupCode,token:pairing.key});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let reachable=true,spawnOptions;
  const context={overlayPreviewPairing:null,overlayPreviewOcrMessage:'',overlayPreviewProcess:null,overlayPreviewStatus:{state:'stopped',message:'Stopped',projectPath:'A:/Spectra-FrontEnd'},
    win:{isDestroyed:()=>false,webContents:{send:()=>{}}},
    axios:{get:async()=>({data:await(await fetch(`http://127.0.0.1:${server.address().port}/hp/pairing`)).json()})},
    overlayPreviewIsReachable:async()=>reachable,watchOverlayPreviewReadiness:()=>{},clearOverlayPreviewHealthCheck:()=>{},
    networkInterfaces:()=>({'Radmin VPN':[{family:'IPv4',internal:false,address:'26.1.2.3'}]}),
    path:require('node:path'),existsSync:()=>true,process:{platform:'win32',env:{ProgramFiles:'C:/Program Files',ComSpec:'cmd.exe'}},
    spawn:(exe,args,options)=>{spawnOptions=options;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;return child;},log:{warn:()=>{}},Buffer};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(extracted,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  try{
    const adopted=await context.startOverlayPreview(null,'A:/Spectra-FrontEnd','TEST');
    assert.equal(adopted.pairing.key,pairing.key);assert.equal(adopted.state,'running');
    assert.equal(context.publishOverlayPreviewStatus('stopped','Stopped').pairing,null);
    reachable=false;
    await context.startOverlayPreview(null,'A:/Spectra-FrontEnd','new-group');
    assert.equal(spawnOptions.env.HP_VPN_HOST,'26.1.2.3');assert.equal(spawnOptions.env.HP_PAIR_GROUP,'NEW-GROUP');
    assert.equal(context.overlayPreviewStatus.pairing,null,'Starting does not show stale key');
    console.log('PASS: client reads active pairing, hides stopped/starting keys, auto-detects Radmin and passes match group to server');
  }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
