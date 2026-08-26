const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { vaultFileStore } = require('./storage/vaultFileStore.cjs');
const { exportService } = require('./export/exportService.cjs');
const { localShareServer } = require('./share/localShareServer.cjs');
const { aiConfigStore } = require('./ai/aiConfigStore.cjs');
const { aiService } = require('./ai/aiService.cjs');

// vault-img 自定义协议：把 vault 内的图片以文件流形式提供给渲染进程，
// 必须在 app ready 之前注册特权。
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault-img', privileges: { stream: true } },
]);

const MAX_NOTES_COUNT = 100000;
const MAX_NOTE_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB per note

function isSafeFolderId(folderId) {
  return typeof folderId === 'string' &&
    folderId.length > 0 &&
    !folderId.includes('..') &&
    !/[\\/]/.test(folderId);
}

function validateNotesArray(notes) {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES_COUNT) return false;
  return notes.every((n) =>
    n && typeof n === 'object' &&
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    n.content.length <= MAX_NOTE_CONTENT_LENGTH &&
    Array.isArray(n.tags) &&
    n.tags.every((tag) => typeof tag === 'string') &&
    (n.folderId === undefined || n.folderId === null || isSafeFolderId(n.folderId))
  );
}

function validateFoldersArray(folders) {
  if (!Array.isArray(folders)) return false;
  return folders.every((f) =>
    f && typeof f === 'object' &&
    typeof f.id === 'string' &&
    typeof f.name === 'string'
  );
}

// Cache of the most recent export dialog results. Export/share IPC handlers
// only accept paths equal to (or located inside) these user-selected values.
let lastSelectedExportDirectory = null;
let lastSelectedSaveFilePath = null;

function isPathEqualOrWithin(targetPath, basePath) {
  let resolvedTarget = path.resolve(targetPath);
  let resolvedBase = path.resolve(basePath);
  if (process.platform === 'win32') {
    resolvedTarget = resolvedTarget.toLowerCase();
    resolvedBase = resolvedBase.toLowerCase();
  }
  return resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(resolvedBase + path.sep);
}

function validateSavePath(savePath) {
  if (typeof savePath !== 'string' || savePath.length === 0) {
    return false;
  }
  const allowedBases = [lastSelectedSaveFilePath, lastSelectedExportDirectory]
    .filter((p) => typeof p === 'string' && p.length > 0);
  return allowedBases.some((base) => isPathEqualOrWithin(savePath, base));
}

// Only the bare message is returned to the renderer; full errors (stack,
// internal paths) stay in the main process console.
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

let mainWindow = null;
let closeConfirmed = false;
let closeFallbackTimer = null;
let shareServerStopPromise = null;

// Stop the share server exactly once; concurrent callers share the same promise.
function stopShareServerOnce() {
  if (!shareServerStopPromise) {
    shareServerStopPromise = (async () => {
      try {
        if (localShareServer.isRunning) {
          await localShareServer.stop();
        }
      } catch (error) {
        console.error('Failed to stop local share server:', error);
      }
    })();
  }
  return shareServerStopPromise;
}

async function closeWindowAfterRendererFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  closeConfirmed = true;
  if (closeFallbackTimer) {
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = null;
  }
  await stopShareServerOnce();
  mainWindow.close();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: '个人知识库',
    // 开发模式窗口图标；打包版由 electron-builder 写入 exe 资源，无需此路径
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '../build/icon.png') }),
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();

const VAULT_IMG_SCHEME_PREFIX = 'vault-img://';

const VAULT_IMG_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// vault-img://<relPath> → vault 根目录下的文件流；path.resolve 防穿越，越界 403。
async function handleVaultImageRequest(request) {
  try {
    const raw = request.url.slice(VAULT_IMG_SCHEME_PREFIX.length).split(/[?#]/)[0];
    let relPath = raw;
    try {
      relPath = decodeURIComponent(raw);
    } catch {
      // 保留原始相对路径
    }
    const vaultRoot = path.resolve(vaultFileStore.getStoragePath());
    const absPath = path.resolve(vaultRoot, relPath);
    if (absPath !== vaultRoot && !absPath.startsWith(vaultRoot + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    const data = await fs.readFile(absPath);
    const mime = VAULT_IMG_MIME_BY_EXT[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': mime } });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return new Response('Not Found', { status: 404 });
    }
    console.error('Failed to serve vault image:', error);
    return new Response('Internal Error', { status: 500 });
  }
}

// 仅对本应用窗口放行 media（麦克风）权限，其余一律拒绝。
function registerPermissionHandler() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isAppWindow = Boolean(mainWindow) && !mainWindow.isDestroyed() &&
      webContents.id === mainWindow.webContents.id;
    callback(permission === 'media' && isAppWindow);
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('vault-img', handleVaultImageRequest);
    registerPermissionHandler();
    createWindow();
  });
}

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
    return await vaultFileStore.loadNotes();
  } catch (error) {
    console.error('Failed to load notes:', error);
    return { notes: [], folders: [], error: toErrorMessage(error) };
  }
});

ipcMain.handle('notes:save', async (_event, notes, folders = []) => {
  try {
    if (!validateNotesArray(notes) || !validateFoldersArray(folders)) {
      return { success: false, error: 'Invalid notes or folders data' };
    }
    await vaultFileStore.saveNotes(notes, folders);
    return { success: true };
  } catch (error) {
    console.error('Failed to save notes:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('notes:getStorageInfo', async () => ({
  path: vaultFileStore.getStoragePath(),
}));

// 在系统文件管理器中打开 vault 数据目录（含 .trash 回收站），便于手动恢复已删除笔记
ipcMain.handle('notes:openStorageFolder', async () => {
  const errorMessage = await shell.openPath(vaultFileStore.getStoragePath());
  if (errorMessage) {
    console.error('Failed to open storage folder:', errorMessage);
    return { success: false, error: errorMessage };
  }
  return { success: true };
});

ipcMain.handle('export:selectDirectory', async () => {
  const selected = await exportService.selectExportDirectory();
  if (selected) {
    lastSelectedExportDirectory = selected;
  }
  return selected;
});

ipcMain.handle('export:selectSaveFile', async (_event, defaultName) => {
  if (typeof defaultName !== 'string' || defaultName.length === 0) {
    return null;
  }
  const selected = await exportService.selectSaveFile(defaultName);
  if (selected) {
    lastSelectedSaveFilePath = selected;
  }
  return selected;
});

ipcMain.handle('export:markdownZip', async (_event, notes, folders, savePath) => {
  try {
    if (!validateNotesArray(notes) || !validateFoldersArray(folders) ||
        !validateSavePath(savePath)) {
      return { success: false, error: 'Invalid export parameters' };
    }
    return await exportService.exportMarkdownZip(notes, folders, savePath);
  } catch (error) {
    console.error('Failed to export markdown zip:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('export:htmlZip', async (_event, notes, folders, savePath) => {
  try {
    if (!validateNotesArray(notes) || !validateFoldersArray(folders) ||
        !validateSavePath(savePath)) {
      return { success: false, error: 'Invalid export parameters' };
    }
    return await exportService.exportHtmlZip(notes, folders, savePath);
  } catch (error) {
    console.error('Failed to export html zip:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('export:markdownDirectory', async (_event, notes, folders, exportPath) => {
  try {
    if (!validateNotesArray(notes) || !validateFoldersArray(folders) ||
        !validateSavePath(exportPath)) {
      return { success: false, error: 'Invalid export parameters' };
    }
    return await exportService.exportMarkdownDirectory(notes, folders, exportPath);
  } catch (error) {
    console.error('Failed to export markdown directory:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('export:htmlDirectory', async (_event, notes, folders, exportPath) => {
  try {
    if (!validateNotesArray(notes) || !validateFoldersArray(folders) ||
        !validateSavePath(exportPath)) {
      return { success: false, error: 'Invalid export parameters' };
    }
    return await exportService.exportHtmlDirectory(notes, folders, exportPath);
  } catch (error) {
    console.error('Failed to export html directory:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('share:startLocalServer', async (_event, exportPath) => {
  try {
    if (!validateSavePath(exportPath)) {
      return { success: false, error: 'Invalid export path' };
    }
    return await localShareServer.start(exportPath);
  } catch (error) {
    console.error('Failed to start local share server:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('share:stopLocalServer', async () => {
  try {
    return await localShareServer.stop();
  } catch (error) {
    console.error('Failed to stop local share server:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('share:getStatus', async () => {
  return localShareServer.getStatus();
});

// ── Phase 3: AI 增强 ────────────────────────────────────────────────

const AI_CAPTURE_MODES = new Set(['study', 'meeting', 'project', 'action_items', 'knowledge']);

const AI_PROVIDERS = new Set(['openai', 'ollama', 'lmstudio']);

const AI_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const AI_IMAGE_DIALOG_FILTERS = [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
];

function sanitizeAttachmentBaseName(name) {
  let safe = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .substring(0, 100);
  if (!safe) safe = 'image';
  // Windows reserves device names even when an extension follows.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe;
}

ipcMain.handle('ai:getConfig', async () => {
  try {
    return await aiConfigStore.getPublicConfig();
  } catch (error) {
    console.error('Failed to get AI config:', error);
    // 配置读取失败时按未配置处理，渲染层降级到本地行为
    return {
      enabled: false,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      hasApiKey: false,
      maskedApiKey: '',
    };
  }
});

ipcMain.handle('ai:saveConfig', async (_event, cfg) => {
  try {
    if (!cfg || typeof cfg !== 'object' ||
        typeof cfg.enabled !== 'boolean' ||
        (cfg.provider !== undefined && !AI_PROVIDERS.has(cfg.provider)) ||
        typeof cfg.baseUrl !== 'string' ||
        typeof cfg.model !== 'string' ||
        (cfg.apiKey !== undefined && typeof cfg.apiKey !== 'string')) {
      return { success: false, error: 'Invalid AI config parameters' };
    }
    await aiConfigStore.save(cfg);
    return { success: true };
  } catch (error) {
    console.error('Failed to save AI config:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:clearApiKey', async () => {
  try {
    await aiConfigStore.clearKey();
    return { success: true };
  } catch (error) {
    console.error('Failed to clear AI API key:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:testConnection', async () => {
  try {
    return await aiService.testConnection();
  } catch (error) {
    console.error('AI connection test failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:listModels', async () => {
  try {
    return await aiService.listModels();
  } catch (error) {
    console.error('AI listModels failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:organizeText', async (_event, input) => {
  try {
    if (!input || typeof input !== 'object' ||
        typeof input.content !== 'string' || input.content.trim().length === 0 ||
        !AI_CAPTURE_MODES.has(input.mode) ||
        (input.title !== undefined && typeof input.title !== 'string')) {
      return { success: false, error: 'Invalid organize parameters' };
    }
    return await aiService.organizeText(input);
  } catch (error) {
    console.error('AI organize failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:summarize', async (_event, input) => {
  try {
    if (!input || typeof input !== 'object' ||
        typeof input.content !== 'string' || input.content.trim().length === 0 ||
        (input.maxLength !== undefined &&
          (typeof input.maxLength !== 'number' || !Number.isFinite(input.maxLength)))) {
      return { success: false, error: 'Invalid summarize parameters' };
    }
    return await aiService.summarize(input);
  } catch (error) {
    console.error('AI summarize failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:suggestTags', async (_event, input) => {
  try {
    if (!input || typeof input !== 'object' ||
        typeof input.title !== 'string' ||
        typeof input.content !== 'string' ||
        !Array.isArray(input.existingTags) ||
        !input.existingTags.every((tag) => typeof tag === 'string') ||
        (input.max !== undefined &&
          (typeof input.max !== 'number' || !Number.isFinite(input.max)))) {
      return { success: false, error: 'Invalid suggestTags parameters' };
    }
    return await aiService.suggestTags(input);
  } catch (error) {
    console.error('AI suggestTags failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:selectImageToVault', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile'],
      filters: AI_IMAGE_DIALOG_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath).toLowerCase();
    if (!AI_IMAGE_EXTENSIONS.has(ext)) {
      return { canceled: false, error: '不支持的图片格式' };
    }
    const vaultRoot = vaultFileStore.getStoragePath();
    const attachmentsDir = path.join(vaultRoot, 'attachments');
    await fs.mkdir(attachmentsDir, { recursive: true });

    const safeStem = sanitizeAttachmentBaseName(path.basename(sourcePath, ext));
    let fileName = `${safeStem}${ext}`;
    let destPath = path.join(attachmentsDir, fileName);
    let counter = 2;
    // 重名时追加唯一后缀
    while (await vaultFileStore.fileExists(destPath)) {
      fileName = `${safeStem}-${counter}${ext}`;
      destPath = path.join(attachmentsDir, fileName);
      counter++;
    }
    await fs.copyFile(sourcePath, destPath);
    return { canceled: false, relPath: `attachments/${fileName}` };
  } catch (error) {
    console.error('Failed to import image into vault:', error);
    return { canceled: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:ocrImage', async (_event, input) => {
  try {
    if (!input || typeof input !== 'object' ||
        typeof input.relPath !== 'string' || input.relPath.length === 0) {
      return { success: false, error: 'Invalid OCR parameters' };
    }
    return await aiService.ocrImage(input);
  } catch (error) {
    console.error('AI ocrImage failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('ai:transcribeAudio', async (_event, input) => {
  try {
    if (!input || typeof input !== 'object' ||
        !ArrayBuffer.isView(input.data) ||
        typeof input.mimeType !== 'string' || input.mimeType.length === 0 ||
        typeof input.fileName !== 'string' || input.fileName.length === 0) {
      return { success: false, error: 'Invalid transcribe parameters' };
    }
    return await aiService.transcribeAudio(input);
  } catch (error) {
    console.error('AI transcribeAudio failed:', error);
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle('app:confirm-close', async () => {
  closeWindowAfterRendererFlush();
  return { success: true };
});

// Stop share server when app is closing
app.on('before-quit', (event) => {
  if (localShareServer.isRunning) {
    // Defer quit until the server has fully stopped.
    event.preventDefault();
    stopShareServerOnce().then(() => app.quit());
  }
});
