const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
contextBridge.exposeInMainWorld('aivn', {
  info: inv('app:info'), getSettings: inv('settings:get'), setSettings: inv('settings:set'),
  catalog: inv('catalog:list'), download: inv('download:start'), cancelDownload: inv('download:cancel'),
  models: inv('models:list'), importModel: inv('models:import'), loadModel: inv('models:load'), unloadModel: inv('models:unload'),
  deleteModel: inv('models:delete'), reveal: inv('models:reveal'), modelStatus: inv('model:status'),
  generate: inv('chat:generate'), stop: inv('chat:stop'),
  convos: inv('convos:list'), saveConvo: inv('convos:save'), deleteConvo: inv('convos:delete'),
  startServer: inv('server:start'), stopServer: inv('server:stop'), serverStatus: inv('server:status'), openExternal: inv('open:external'),
  pickFiles: inv('files:pick'), extractFiles: inv('files:extract'), pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  checkUpdate: inv('update:check'), downloadUpdate: inv('update:download'), installUpdate: inv('update:install'), openReleases: inv('update:open'), updateState: inv('update:state'),
  onUpdate: on('update:status'), onDocInfo: on('chat:docinfo'),
  onToken: on('chat:token'), onModelStatus: on('model:status'), onServerLog: on('server:log'),
  onDownloadProgress: on('download:progress'), onDownloadDone: on('download:done'), onDownloadError: on('download:error'), onDownloadCancelled: on('download:cancelled'),
});
