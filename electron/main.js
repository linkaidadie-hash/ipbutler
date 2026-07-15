const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: '知产管家',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载本地前端
  mainWindow.loadFile(path.join(__dirname, '..', 'login.html'));

  // 登录成功后跳转主页
  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    if (url.includes('index.html')) {
      mainWindow.setTitle('知产管家 - 桌面版');
    }
  });
}

// ===== IPC: 选择本地源码目录 =====
ipcMain.handle('select-source-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择源码目录',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ===== IPC: 读取源码文件 =====
ipcMain.handle('read-source-files', async (event, dirPath) => {
  const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.cs', '.rb', '.php', '.vue', '.svelte', '.css', '.scss', '.html', '.sql', '.sh', '.yaml', '.yml', '.json'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'vendor', 'target'];
  const ignoreFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.min.js', '.min.css'];

  const files = [];
  
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!codeExts.includes(ext)) continue;
        if (ignoreFiles.some(f => entry.name.includes(f))) continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const relPath = path.relative(dirPath, fullPath);
          files.push({
            name: relPath,
            size: content.length,
            text: content,
            lines: lines.length,
          });
        } catch (e) {
          // skip binary or unreadable
        }
      }
    }
  }

  walk(dirPath);

  // Sort: front-matter first, then by path
  files.sort((a, b) => a.name.localeCompare(b.name));

  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  
  return {
    files: files.slice(0, 500), // max 500 files
    totalLines,
    fileCount: files.length,
  };
});

// ===== IPC: 保存项目配置 =====
ipcMain.handle('save-project', async (event, projectData, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存项目配置',
    defaultPath: defaultName || 'project.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, JSON.stringify(projectData, null, 2), 'utf-8');
  return result.filePath;
});

// ===== IPC: 保存 PDF =====
ipcMain.handle('save-pdf', async (event, base64Data, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存 PDF',
    defaultPath: defaultName || 'document.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(result.filePath, buffer);
  return result.filePath;
});

// ===== IPC: 获取 app 版本信息 =====
ipcMain.handle('get-version', () => {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
