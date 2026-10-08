const {spawn} = require('node:child_process');
const path = require('node:path');
const {startHpBridge} = require('./hp-bridge.cjs');
const bridge = startHpBridge();
bridge.on('error', error => {
  if(error.code === 'EADDRINUSE') console.warn('HP bridge port 5210 is already occupied; leaving the existing service untouched.');
  else console.error('HP bridge:',error.message);
});
const child=spawn(process.execPath,[path.resolve(__dirname,'../node_modules/@angular/cli/bin/ng.js'),'serve','--configuration','development',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);bridge.close();process.exitCode=1;});
child.on('exit',code=>{bridge.close();process.exitCode=code ?? 0;});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{child.kill();bridge.close();});
