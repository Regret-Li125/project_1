const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { notesFileStore } = require('./storage/notesFileStore.cjs');
const { exportService } = require('./export/exportService.cjs');
const { localShareServer } = require('./share/localShareServer.cjs');

let mainWindow = null;
let closeConfirmed = false;
let closeFallbackTimer = null;

async function closeWindowAfterRendererFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  closeConfirmed = true;
  if (closeFallbackTimer) {
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = null;
  }
  if (localShareServer.isRunning) {
    await localShareServer.stop();
  }
  mainWindow.close();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: '个人知识库',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('close', (event) => {
    if (closeConfirmed) return;

    event.preventDefault();
    mainWindow.webContents.send('app:request-close');
    closeFallbackTimer = setTimeout(closeWindowAfterRendererFlush, 3000);
  });

  mainWindow.on('closed', () => {
    if (closeFallbackTimer) {
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = null;
    }
    closeConfirmed = false;
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('notes:load', async () => {
  try {
    return await notesFileStore.loadNotes();
  } catch (error) {
    console.error('Failed to load notes:', error);
    return { notes: [], folders: [] };
  }
});

ipcMain.handle('notes:save', async (_event, notes, folders = []) => {
  try {
    await notesFileStore.saveNotes(notes, folders);
    return { success: true };
  } catch (error) {
    console.error('Failed to save notes:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('notes:getStorageInfo', async () => ({
  path: notesFileStore.getStoragePath(),
}));

ipcMain.handle('export:selectDirectory', async () => {
  return await exportService.selectExportDirectory();
});

ipcMain.handle('export:selectSaveFile', async (_event, defaultName) => {
  return await exportService.selectSaveFile(defaultName);
});

ipcMain.handle('export:markdownZip', async (_event, notes, folders, attachments, savePath) => {
  try {
    return await exportService.exportMarkdownZip(notes, folders, attachments, savePath);
  } catch (error) {
    console.error('Failed to export markdown zip:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('export:htmlZip', async (_event, notes, folders, attachments, savePath) => {
  try {
    return await exportService.exportHtmlZip(notes, folders, attachments, savePath);
  } catch (error) {
    console.error('Failed to export html zip:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('export:markdownDirectory', async (_event, notes, folders, attachments, exportPath) => {
  try {
    return await exportService.exportMarkdownDirectory(notes, folders, attachments, exportPath);
  } catch (error) {
    console.error('Failed to export markdown directory:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('export:htmlDirectory', async (_event, notes, folders, attachments, exportPath) => {
  try {
    return await exportService.exportHtmlDirectory(notes, folders, attachments, exportPath);
  } catch (error) {
    console.error('Failed to export html directory:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('share:startLocalServer', async (_event, exportPath) => {
  try {
    return await localShareServer.start(exportPath);
  } catch (error) {
    console.error('Failed to start local share server:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('share:stopLocalServer', async () => {
  try {
    return await localShareServer.stop();
  } catch (error) {
    console.error('Failed to stop local share server:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('share:getStatus', async () => {
  return localShareServer.getStatus();
});

ipcMain.handle('app:confirm-close', async () => {
  closeWindowAfterRendererFlush();
  return { success: true };
});

// Stop share server when app is closing
app.on('before-quit', async () => {
  if (localShareServer.isRunning) {
    await localShareServer.stop();
  }
});
