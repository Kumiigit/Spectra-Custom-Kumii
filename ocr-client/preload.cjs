const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('capturePicker',{
  sources:()=>ipcRenderer.invoke('capture-sources'),
  choose:id=>ipcRenderer.send('capture-choose',id)
});
