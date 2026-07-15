const { contextBridge, ipcRenderer } = require('electron');

// 暴露桌面版 API 给前端
contextBridge.exposeInMainWorld('desktopAPI', {
  // 选择本地源码目录
  selectSourceDir: () => ipcRenderer.invoke('select-source-dir'),
  
  // 读取源码文件
  readSourceFiles: (dirPath) => ipcRenderer.invoke('read-source-files', dirPath),
  
  // 保存项目配置
  saveProject: (data, defaultName) => ipcRenderer.invoke('save-project', data, defaultName),
  
  // 保存 PDF
  savePdf: (base64Data, defaultName) => ipcRenderer.invoke('save-pdf', base64Data, defaultName),
  
  // 获取版本信息
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // 判断是否桌面版
  isDesktop: true,
});
