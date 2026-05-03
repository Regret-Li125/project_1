import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { notesFileStore } from './storage/notesFileStore';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: '个人知识库',
    icon: path.join(__dirname, '../public/icon.png'),
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
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

// IPC Handlers
ipcMain.handle('notes:load', async () => {
  try {
    return await notesFileStore.loadNotes();
  } catch (error) {
    console.error('Failed to load notes:', error);
    return [];
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

ipcMain.handle('notes:getStorageInfo', async () => {
  return {
    path: notesFileStore.getStoragePath(),
  };
});
