const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API endpoints to the React frontend
contextBridge.exposeInMainWorld('electronAPI', {
  dbQuery: (sql, params = []) => ipcRenderer.invoke('db-query', sql, params),
  dbRun: (sql, params = []) => ipcRenderer.invoke('db-run', sql, params),
  dbGet: (sql, params = []) => ipcRenderer.invoke('db-get', sql, params),
  bcryptHash: (password) => ipcRenderer.invoke('bcrypt-hash', password),
  bcryptCompare: (password, hash) => ipcRenderer.invoke('bcrypt-compare', password, hash)
});
