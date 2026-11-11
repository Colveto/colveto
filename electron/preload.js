const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  printToPDF: async () => {
    const buf = await ipcRenderer.invoke('print-to-pdf');
    // Buffer comes through IPC as Uint8Array
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  },
  printRouteToPDF: async (relativeHashRoute) => {
    const buf = await ipcRenderer.invoke('print-route-to-pdf', relativeHashRoute);
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  },
  // Mises à jour automatiques
  getUpdateState: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_e, st) => cb(st);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
