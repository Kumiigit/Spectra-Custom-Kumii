const {app,BrowserWindow,desktopCapturer,dialog,ipcMain,Menu}=require('electron');
const path=require('node:path');
let main,host,picker,pending,sources=[];
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(main){if(main.isMinimized())main.restore();main.show();main.focus();}});
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  const resource=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
  const bridge=app.isPackaged?path.join(resource,'ocr-observer.cjs'):path.join(resource,'scripts/ocr-observer.cjs');
  const root=path.join(resource,app.isPackaged?'hp-reader':'public/hp-reader');
  host=require(bridge).createObserverHost(root);
  await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${host.address().port}`;
  main=new BrowserWindow({width:1280,height:860,minWidth:1000,minHeight:680,title:'Spectra OCR Observer',backgroundColor:'#0b141a',show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  main.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  main.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/hp-reader/'))event.preventDefault();});
  main.webContents.session.setPermissionRequestHandler((webContents,permission,callback)=>callback(webContents===main.webContents&&['media','display-capture'].includes(permission)&&webContents.getURL().startsWith(origin+'/')));
  main.webContents.session.setDisplayMediaRequestHandler(async(request,callback)=>{
    if(request.securityOrigin!==origin||pending){callback({});return;}
    try{
      sources=await desktopCapturer.getSources({types:['window','screen'],thumbnailSize:{width:300,height:170}});
      pending=callback;
      picker=new BrowserWindow({parent:main,modal:true,width:850,height:650,title:'Choose VALORANT capture',backgroundColor:'#0b141a',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
      picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      picker.webContents.on('will-navigate',event=>event.preventDefault());
      picker.on('closed',()=>{picker=null;if(pending){const cancel=pending;pending=null;cancel({});}sources=[];});
      await picker.loadFile(path.join(__dirname,'source-picker.html'));
    }catch{pending=null;callback({});}
  });
  ipcMain.handle('capture-sources',event=>event.sender===picker?.webContents?sources.map(s=>({id:s.id,name:s.name,thumbnail:s.thumbnail.toDataURL()})):[]);
  ipcMain.on('capture-choose',(event,id)=>{
    if(event.sender!==picker?.webContents||!pending)return;
    const source=sources.find(s=>s.id===id);if(!source)return;
    const accept=pending;pending=null;accept({video:source});picker.close();
  });
  await main.loadURL(`${origin}/hp-reader/dual.html?desktop=1`);
  if(process.env.SPECTRA_OCR_SMOKE){
    const fs=require('node:fs');
    await new Promise(resolve=>setTimeout(resolve,600));
    const state=await main.webContents.executeJavaScript(`({title:document.title,tiles:document.querySelectorAll('.player-tile').length,pairing:document.getElementById('pair').closest('details').open,forward:document.getElementById('forward').checked,errors:document.getElementById('status').textContent})`);
    if(state.title!=='Spectra OCR Observer'||state.tiles!==10||!state.pairing||state.forward)throw Error('Desktop UI smoke test failed: '+JSON.stringify(state));
    fs.writeFileSync(process.env.SPECTRA_OCR_SMOKE,(await main.webContents.capturePage()).toPNG());
    console.log('PASS: desktop window, ten slots, pairing screen, forwarding off before pairing');
    app.quit();
  }else main.show();
}).catch(error=>{dialog.showErrorBox('Spectra OCR Observer',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{host?.close();});
}
