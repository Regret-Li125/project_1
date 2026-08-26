import type { Note, Folder, ShareScope, ShareResult } from '../types/note';

// Windows 保留设备名（不含扩展名部分）
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function collectShareScope(
  notes: Note[],
  folders: Folder[],
  scope: ShareScope
): ShareResult {
  let selectedNotes: Note[] = [];
  let selectedFolders: Folder[] = [];

  switch (scope.type) {
    case 'note': {
      const note = notes.find((n) => n.id === scope.noteId);
      if (note) {
        selectedNotes = [note];
      }
      break;
    }
    case 'folder': {
      // 沿 parentId 递归收集所有子孙文件夹（含环保护）
      const folderIds = new Set<string>();
      const queue: string[] = [scope.folderId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (folderIds.has(currentId)) continue;
        folderIds.add(currentId);
        for (const folder of folders) {
          if (folder.parentId === currentId) {
            queue.push(folder.id);
          }
        }
      }
      selectedFolders = folders.filter((folder) => folderIds.has(folder.id));
      selectedNotes = notes.filter(
        (note) => note.folderId !== null && folderIds.has(note.folderId)
      );
      break;
    }
    case 'vault': {
      selectedNotes = [...notes];
      selectedFolders = [...folders];
      break;
    }
  }

  return {
    notes: selectedNotes,
    folders: selectedFolders,
    noteCount: selectedNotes.length,
    folderCount: selectedFolders.length,
  };
}

// 在所选目录下生成专用导出子目录：<所选目录>/knowledge-share-<时间戳>
export function buildShareExportPath(
  baseDir: string,
  timestamp: number = Date.now()
): string {
  const trimmed = baseDir.replace(/[\\/]+$/, '');
  return `${trimmed}/knowledge-share-${timestamp}`;
}

export function sanitizeFileName(name: string): string {
  // 剔除控制字符（\x00-\x1f 与 \x7f）
  // eslint-disable-next-line no-control-regex
  let sanitized = name.replace(/[\x00-\x1f\x7f]/g, '');
  sanitized = sanitized
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');
  // 按码点截断，避免切断代理对（如 emoji）
  sanitized = Array.from(sanitized).slice(0, 200).join('');

  // 结果为空或纯 . / .. 序列时回退
  if (sanitized.length === 0 || /^\.+$/.test(sanitized)) {
    return 'untitled';
  }

  // Windows 保留名加前缀
  const baseName = sanitized.split('.')[0];
  if (WINDOWS_RESERVED_NAME.test(baseName)) {
    sanitized = `_${sanitized}`;
  }

  return sanitized;
}
