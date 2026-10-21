// Cửa sổ ẩn "bộ nghe": chỉ nhận việc và trả kết quả qua IPC, không có quyền Node.
const { ipcRenderer, contextBridge } = require('electron');
contextBridge.exposeInMainWorld('mediaIO', {
  onJob: (cb) => ipcRenderer.on('media:job', (_e, j) => cb(j)),
  onCancel: (cb) => ipcRenderer.on('media:cancel', (_e, id) => cb(id)),
  progress: (id, p) => ipcRenderer.send('media:progress', id, p),
  result: (id, r) => ipcRenderer.send('media:result', id, r),
  fail: (id, msg, code) => ipcRenderer.send('media:fail', id, String(msg), code || null),
  ready: (info) => ipcRenderer.send('media:ready', info),
});
