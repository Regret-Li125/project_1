const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const yaml = require('js-yaml');

// folderId may only contain these characters; anything else is rejected to
// prevent path traversal outside the vault folders directory.
const SAFE_FOLDER_ID = /^[A-Za-z0-9_-]+$/;

// Windows reserves these device names for the base name (before any
// extension), case-insensitive: "CON", "con.md", "COM1.txt" are all invalid.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// Keep full paths comfortably below the Windows MAX_PATH limit (260), leaving
// headroom for de-dup suffixes and the ".md" extension.
const MAX_PATH_BUDGET = 260 - 32;

class VaultFileStore {
  constructor() {
    this._initialized = false;
    this.vaultPath = null;
    this.metaPath = null;
    this.notesDir = null;
    this.foldersDir = null;
    this.legacyPath = null;
    this.legacyBackupPath = null;
    this.fileIndex = new Map(); // noteId -> vault-relative path
    this._saveQueue = Promise.resolve(); // serializes saveNotes calls
  }

  _ensureInitialized() {
    if (this._initialized) return;
    const baseDir = path.join(app.getPath('userData'), 'personal-knowledge-notes');
    this.vaultPath = path.join(baseDir, 'vault');
    this.metaPath = path.join(this.vaultPath, '.vault-meta.json');
    this.notesDir = path.join(this.vaultPath, 'notes');
    this.foldersDir = path.join(this.vaultPath, 'folders');
    // 回收站：删除的笔记移入此处而非直接抹除，用户可手工移回 notes/ 恢复。
    // 加载扫描只覆盖 notes/ 与 folders/，.trash 不会被当作笔记读入。
    this.trashDir = path.join(this.vaultPath, '.trash');
    this.legacyPath = path.join(baseDir, 'notes.json');
    this.legacyBackupPath = path.join(baseDir, 'notes.json.bak');
    this._initialized = true;
  }

  getStoragePath() {
    this._ensureInitialized();
    return this.vaultPath;
  }

  // ── Directory helpers ──────────────────────────────────────────────

  async ensureDirectories() {
    await fs.mkdir(this.notesDir, { recursive: true });
    await fs.mkdir(this.foldersDir, { recursive: true });
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Returns true when the directory (or any of its subdirectories) holds at
  // least one .md file. Used by the migration guard so that stray files
  // (e.g. leftover .tmp files) do not block a legacy migration.
  async dirHasMdFiles(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) return true;
        if (entry.isDirectory()) {
          if (await this.dirHasMdFiles(path.join(dirPath, entry.name))) return true;
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return false;
  }

  // Remove leftover atomic-write temp files from a previous crashed run.
  async cleanupTempFiles() {
    const dirs = [this.notesDir];
    try {
      const entries = await fs.readdir(this.foldersDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) dirs.push(path.join(this.foldersDir, entry.name));
      }
    } catch {
      // folders/ directory doesn't exist
    }
    for (const dir of dirs) {
      try {
        const names = await fs.readdir(dir);
        for (const name of names) {
          if (name.endsWith('.tmp')) {
            await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    }
    await fs.rm(`${this.metaPath}.tmp`, { force: true }).catch(() => {});
  }

  // ── Path safety helpers ───────────────────────────────────────────

  sanitizeFolderId(folderId) {
    if (folderId === null || folderId === undefined || folderId === '') return null;
    const id = String(folderId);
    if (SAFE_FOLDER_ID.test(id)) return id;
    console.warn('Invalid folderId, storing note at vault root instead:', id);
    return null;
  }

  // Resolve the directory a note belongs to. Invalid folderId values fall
  // back to the vault root; the result is asserted to stay inside foldersDir.
  resolveNoteDir(folderId) {
    const safeId = this.sanitizeFolderId(folderId);
    if (!safeId) return { folderId: null, dir: this.notesDir };
    const dir = path.resolve(this.foldersDir, safeId);
    const root = path.resolve(this.foldersDir);
    if (!dir.startsWith(root + path.sep)) {
      console.warn('folderId escapes foldersDir, storing note at vault root instead:', safeId);
      return { folderId: null, dir: this.notesDir };
    }
    return { folderId: safeId, dir };
  }

  isPathInsideVault(absPath) {
    const resolved = path.resolve(absPath);
    const root = path.resolve(this.vaultPath);
    return resolved.startsWith(root + path.sep);
  }

  // ── File name helpers ─────────────────────────────────────────────

  sanitizeFileName(title, targetDir) {
    if (!title || !title.trim()) return 'untitled';
    let name = title.trim();
    name = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_');
    name = name.replace(/\s+/g, '_');
    name = name.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!name) name = 'untitled';

    // Truncate so the full path (dir + name + suffix + ".md") stays below
    // MAX_PATH with headroom; slice by code points so surrogate pairs are
    // never split.
    const dirLen = targetDir ? path.resolve(targetDir).length + 1 : 0;
    const maxLen = Math.max(32, MAX_PATH_BUDGET - dirLen - 3);
    const chars = Array.from(name);
    if (chars.length > maxLen) {
      name = chars.slice(0, maxLen).join('');
      // Truncation may expose trailing dots/spaces again
      name = name.replace(/[.\s]+$/g, '');
      if (!name) name = 'untitled';
    }

    // Windows reserves device names even when an extension follows.
    if (WINDOWS_RESERVED_NAME.test(name)) name = `${name}_`;
    return name;
  }

  resolveUniquePath(targetDir, baseName, noteId, usedNames) {
    if (!usedNames.has(targetDir)) {
      usedNames.set(targetDir, new Set());
    }
    const dirNames = usedNames.get(targetDir);

    let candidate = baseName;
    if (dirNames.has(candidate.toLowerCase())) {
      // Sanitize the id-derived suffix so the name stays filesystem-safe
      let suffix = String(noteId).replace(/[^A-Za-z0-9]/g, '').substring(0, 8);
      if (!suffix) suffix = crypto.randomBytes(4).toString('hex');
      candidate = `${baseName}-${suffix}`;
    }
    let counter = 2;
    while (dirNames.has(candidate.toLowerCase())) {
      candidate = `${baseName}-${counter}`;
      counter++;
    }
    dirNames.add(candidate.toLowerCase());
    return path.join(targetDir, `${candidate}.md`);
  }

  // Pick a name that is free both in this batch (usedNames) and on disk.
  async resolveOnDiskUniquePath(targetDir, baseName, usedNames) {
    if (!usedNames.has(targetDir)) {
      usedNames.set(targetDir, new Set());
    }
    const dirNames = usedNames.get(targetDir);
    let counter = 2;
    let candidate = `${baseName}-${counter}`;
    let absPath = path.join(targetDir, `${candidate}.md`);
    while (dirNames.has(candidate.toLowerCase()) || (await this.fileExists(absPath))) {
      counter++;
      candidate = `${baseName}-${counter}`;
      absPath = path.join(targetDir, `${candidate}.md`);
    }
    dirNames.add(candidate.toLowerCase());
    return absPath;
  }

  // ── Frontmatter helpers ───────────────────────────────────────────

  parseFrontmatter(text) {
    if (!text.startsWith('---')) {
      return { frontmatter: {}, content: text };
    }
    // Consume the blank separator line after the closing "---" as well, so a
    // file written by this app round-trips to the exact same note content.
    const endMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?(?:\r?\n)?/);
    if (!endMatch) {
      return { frontmatter: {}, content: text };
    }
    const yamlBlock = endMatch[1];
    const content = text.substring(endMatch[0].length);
    let frontmatter = {};
    try {
      frontmatter = yaml.load(yamlBlock) || {};
    } catch (e) {
      console.warn('Failed to parse frontmatter:', e.message);
    }
    return { frontmatter, content };
  }

  serializeFrontmatter(note) {
    const meta = {};
    if (note.id) meta.id = note.id;
    if (note.title) meta.title = note.title;
    if (note.tags && note.tags.length > 0) meta.tags = note.tags;
    if (note.folderId) meta.folderId = note.folderId;
    if (note.sourceType && note.sourceType !== 'manual') meta.sourceType = note.sourceType;
    if (note.sourceUrl) meta.sourceUrl = note.sourceUrl;
    if (note.createdAt) meta.createdAt = note.createdAt;
    if (note.updatedAt) meta.updatedAt = note.updatedAt;
    if (note.lastOpenedAt) meta.lastOpenedAt = note.lastOpenedAt;
    if (note.lastReviewedAt) meta.lastReviewedAt = note.lastReviewedAt;

    const yamlStr = yaml.dump(meta, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    return `---\n${yamlStr}---\n\n`;
  }

  // ── Read / write single .md file ──────────────────────────────────

  async readTextFile(absPath) {
    const raw = await fs.readFile(absPath, 'utf-8');
    return raw.replace(/^\uFEFF/, ''); // strip a UTF-8 BOM if present
  }

  async readMdFile(absPath, fallbackFolderId) {
    const raw = await this.readTextFile(absPath);
    const { frontmatter: fm, content } = this.parseFrontmatter(raw);

    const note = {
      id: fm.id || crypto.randomUUID(),
      title: fm.title || '',
      content: content,
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      folderId: fm.folderId || fallbackFolderId || null,
      path: path.relative(this.vaultPath, absPath).replace(/\\/g, '/'),
      sourceType: fm.sourceType || 'manual',
      sourceUrl: fm.sourceUrl || undefined,
      createdAt: fm.createdAt || new Date().toISOString(),
      updatedAt: fm.updatedAt || new Date().toISOString(),
      lastOpenedAt: fm.lastOpenedAt || null,
      lastReviewedAt: fm.lastReviewedAt || null,
    };

    if (!fm.id) {
      // Persist the generated id so it stays stable across restarts
      try {
        await this.writeMdFile(absPath, note);
      } catch (e) {
        console.warn('Failed to write back generated note id:', absPath, e.message);
      }
    }
    return note;
  }

  async writeMdFile(absPath, note) {
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
    const content = this.serializeFrontmatter(note) + (note.content || '');
    await this.atomicWrite(absPath, content);
  }

  async atomicWrite(absPath, content) {
    const tempPath = absPath + '.tmp';
    await fs.writeFile(tempPath, content, 'utf-8');
    try {
      await fs.rename(tempPath, absPath);
    } catch (error) {
      // Windows: rename fails with EPERM/EEXIST when the target already
      // exists; only then fall back to removing the target first. Any other
      // error is rethrown with the temp file cleaned up.
      if (!error || (error.code !== 'EPERM' && error.code !== 'EEXIST')) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      try {
        await fs.rm(absPath, { force: true });
        await fs.rename(tempPath, absPath);
      } catch (retryError) {
        // Keep the temp file so the new content is not lost on failure
        console.warn('Atomic write fallback failed, temp file kept at:', tempPath, retryError);
        throw retryError;
      }
    }
  }

  // 把待删除的笔记文件移入 vault 根下的 .trash/ 回收站。
  // 文件名加时间戳前缀（ISO 时间中的冒号对 Windows 非法，替换为连字符），
  // 同一笔记多次删除不会互相覆盖；总长受限以避免超出 MAX_PATH。
  async moveNoteToTrash(absPath) {
    await fs.mkdir(this.trashDir, { recursive: true });
    const baseName = path.basename(absPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(baseName);
    let stem = `${stamp}_${path.basename(baseName, ext)}`;
    if (stem.length > 140) {
      stem = stem.slice(0, 140);
    }
    let trashPath = path.join(this.trashDir, `${stem}${ext}`);
    let counter = 2;
    while (await this.fileExists(trashPath)) {
      trashPath = path.join(this.trashDir, `${stem}-${counter}${ext}`);
      counter++;
    }
    try {
      await fs.rename(absPath, trashPath);
    } catch {
      // rename 失败（如文件被占用）：先复制再删原文件；
      // 复制也失败则抛错，由调用方保留原文件，绝不静默销毁数据。
      await fs.copyFile(absPath, trashPath);
      await fs.rm(absPath, { force: true });
    }
  }

  // ── Folder metadata helpers ───────────────────────────────────────

  async readMeta() {
    try {
      const raw = await this.readTextFile(this.metaPath);
      const parsed = JSON.parse(raw);
      return { folders: Array.isArray(parsed.folders) ? parsed.folders : [] };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { folders: [] };
      }
      console.warn('Failed to read vault meta:', error);
      return { folders: [] };
    }
  }

  async writeMeta(folders) {
    const payload = JSON.stringify({ version: 2, folders }, null, 2);
    await this.atomicWrite(this.metaPath, payload);
  }

  // ── Migration from legacy notes.json ──────────────────────────────

  parseLegacyPayload(data) {
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      };
    } catch {
      return null;
    }
  }

  async migrateFromLegacy() {
    console.log('Migrating from notes.json to vault...');

    let payload = null;
    try {
      const data = await this.readTextFile(this.legacyPath);
      payload = this.parseLegacyPayload(data);
    } catch {
      // Primary file unreadable, try backup
    }
    if (!payload) {
      try {
        const backupData = await this.readTextFile(this.legacyBackupPath);
        payload = this.parseLegacyPayload(backupData);
      } catch {
        // Both failed
      }
    }
    if (!payload) {
      console.error('Migration failed: could not read notes.json or backup');
      return { notes: [], folders: [] };
    }

    await this.ensureDirectories();

    const notes = [];
    const usedNames = new Map();
    let migrated = 0;
    let failed = 0;

    for (const raw of payload.notes) {
      try {
        const { folderId: safeFolderId, dir: targetDir } = this.resolveNoteDir(raw.folderId);
        const note = {
          id: raw.id || crypto.randomUUID(),
          title: raw.title || '',
          content: raw.content || '',
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          folderId: safeFolderId,
          path: '',
          sourceType: raw.sourceType || 'manual',
          sourceUrl: raw.sourceUrl || undefined,
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || new Date().toISOString(),
          lastOpenedAt: raw.lastOpenedAt || null,
          lastReviewedAt: raw.lastReviewedAt || null,
        };

        const baseName = this.sanitizeFileName(note.title, targetDir);
        const absPath = this.resolveUniquePath(targetDir, baseName, note.id, usedNames);

        await this.writeMdFile(absPath, note);

        note.path = path.relative(this.vaultPath, absPath).replace(/\\/g, '/');
        this.fileIndex.set(note.id, note.path);
        notes.push(note);
        migrated++;
      } catch (e) {
        failed++;
        console.warn('Failed to migrate note:', raw.title, e.message);
      }
    }

    await this.writeMeta(payload.folders);

    // Rename legacy file to prevent re-migration — only when every note was
    // migrated; otherwise keep the original so no data is stranded.
    if (failed === 0) {
      try {
        await fs.rename(this.legacyPath, `${this.legacyPath}.migrated`);
      } catch (e) {
        console.warn('Failed to rename legacy notes.json:', e.message);
      }
    } else {
      console.error(`Migration incomplete: ${failed} note(s) failed; keeping original notes.json`);
    }

    console.log(`Migrated ${migrated} notes and ${payload.folders.length} folders from notes.json to vault`);
    return { notes, folders: payload.folders };
  }

  // ── Load from vault ───────────────────────────────────────────────

  async scanMdFiles(dirPath) {
    const results = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(path.join(dirPath, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return results;
  }

  async loadFromVault() {
    const { folders } = await this.readMeta();
    const notes = [];
    this.fileIndex = new Map();

    // Scan root notes
    const rootFiles = await this.scanMdFiles(this.notesDir);
    for (const absPath of rootFiles) {
      try {
        const note = await this.readMdFile(absPath, null);
        // Location is the source of truth: a file physically inside notes/
        // is a root note, so a folderId in its frontmatter is intentionally
        // discarded (otherwise the next save would silently move the file
        // into that folder). The folder branch below only fills a *missing*
        // folderId because there the directory name is the fallback.
        note.folderId = null;
        note.path = path.relative(this.vaultPath, absPath).replace(/\\/g, '/');
        this.fileIndex.set(note.id, note.path);
        notes.push(note);
      } catch (e) {
        console.warn('Failed to read note file:', absPath, e.message);
      }
    }

    // Scan folder subdirectories
    try {
      const folderEntries = await fs.readdir(this.foldersDir, { withFileTypes: true });
      for (const entry of folderEntries) {
        if (!entry.isDirectory()) continue;
        const folderId = entry.name;
        const folderDir = path.join(this.foldersDir, folderId);
        const mdFiles = await this.scanMdFiles(folderDir);
        for (const absPath of mdFiles) {
          try {
            const note = await this.readMdFile(absPath, folderId);
            if (!note.folderId) note.folderId = folderId;
            note.path = path.relative(this.vaultPath, absPath).replace(/\\/g, '/');
            this.fileIndex.set(note.id, note.path);
            notes.push(note);
          } catch (e) {
            console.warn('Failed to read note file:', absPath, e.message);
          }
        }
      }
    } catch {
      // folders/ directory doesn't exist
    }

    return { notes, folders };
  }

  // ── Public API ────────────────────────────────────────────────────

  async loadNotes() {
    this._ensureInitialized();
    await this.ensureDirectories();
    await this.cleanupTempFiles();

    const legacyExists = await this.fileExists(this.legacyPath);
    const vaultHasNotes = await this.dirHasMdFiles(this.notesDir);
    const vaultHasFolders = await this.dirHasMdFiles(this.foldersDir);
    // Folder metadata alone also counts as vault content, so an empty-notes
    // vault with folders is never mistaken for a fresh install.
    const { folders: metaFolders } = await this.readMeta();
    const vaultHasContent = vaultHasNotes || vaultHasFolders || metaFolders.length > 0;

    if (legacyExists && !vaultHasContent) {
      return await this.migrateFromLegacy();
    }

    if (!legacyExists && !vaultHasContent) {
      return { notes: [], folders: [] };
    }

    return await this.loadFromVault();
  }

  saveNotes(notes, folders = []) {
    // Serialize saves through a promise queue so concurrent IPC calls never
    // interleave file operations; the chain stays alive across failures.
    const run = this._saveQueue.then(() => this._saveNotesImpl(notes, folders));
    this._saveQueue = run.catch(() => {});
    return run;
  }

  async _saveNotesImpl(notes, folders = []) {
    this._ensureInitialized();
    await this.ensureDirectories();

    // Snapshot the index at function entry: all lookups and the delete pass
    // below operate on this snapshot, never on live mutable state.
    const previousIndex = this.fileIndex;
    const newFileIndex = new Map();
    const incomingIds = new Set(notes.map((n) => n.id));
    const usedNames = new Map();

    // Create / update / move notes
    for (const note of notes) {
      const { folderId: safeFolderId, dir: targetDir } = this.resolveNoteDir(note.folderId);
      const noteToWrite = safeFolderId === note.folderId ? note : { ...note, folderId: safeFolderId };
      const baseName = this.sanitizeFileName(note.title, targetDir);
      let desiredAbsPath = this.resolveUniquePath(targetDir, baseName, note.id, usedNames);
      let desiredRelPath = path.relative(this.vaultPath, desiredAbsPath).replace(/\\/g, '/');

      const currentRelPath = previousIndex.get(note.id);
      const currentAbsPath = currentRelPath
        ? path.join(this.vaultPath, currentRelPath)
        : null;
      // On case-insensitive filesystems a pure case change points at the same file
      const sameFileIgnoreCase = Boolean(currentAbsPath)
        && currentAbsPath.toLowerCase() === desiredAbsPath.toLowerCase();

      if (currentRelPath !== desiredRelPath && !sameFileIgnoreCase
          && (await this.fileExists(desiredAbsPath))) {
        // A file outside the index already occupies this name; pick a unique one
        desiredAbsPath = await this.resolveOnDiskUniquePath(targetDir, baseName, usedNames);
        desiredRelPath = path.relative(this.vaultPath, desiredAbsPath).replace(/\\/g, '/');
      }

      if (!currentRelPath) {
        // CREATE
        await this.writeMdFile(desiredAbsPath, noteToWrite);
      } else if (currentRelPath !== desiredRelPath) {
        // MOVE / RENAME: write the new path first and remove the old file
        // only after the write succeeded, so a failure never loses the note.
        await this.writeMdFile(desiredAbsPath, noteToWrite);
        if (!sameFileIgnoreCase) {
          try {
            await fs.rm(currentAbsPath, { force: true });
          } catch {
            // Old file may not exist
          }
        }
      } else {
        // UPDATE in place: skip the write when nothing changed
        const newContent = this.serializeFrontmatter(noteToWrite) + (noteToWrite.content || '');
        let existingContent = null;
        try {
          existingContent = await this.readTextFile(desiredAbsPath);
        } catch {
          // Unreadable file: rewrite it below
        }
        if (existingContent !== newContent) {
          await this.writeMdFile(desiredAbsPath, noteToWrite);
        }
      }

      newFileIndex.set(note.id, desiredRelPath);
    }

    // DELETE notes no longer present (based on the entry snapshot)
    for (const [noteId, relPath] of previousIndex) {
      if (incomingIds.has(noteId)) continue;
      if (!this.isPathInsideVault(path.join(this.vaultPath, relPath))) {
        console.warn('Skipping delete of path outside the vault:', relPath);
        continue;
      }
      const absPath = path.join(this.vaultPath, relPath);
      try {
        await this.moveNoteToTrash(absPath);
        // Clean up empty parent directory
        const parentDir = path.dirname(absPath);
        if (parentDir !== this.notesDir && parentDir !== this.foldersDir) {
          const remaining = await fs.readdir(parentDir).catch(() => []);
          if (remaining.length === 0) {
            await fs.rmdir(parentDir).catch(() => {});
          }
        }
      } catch (e) {
        // 移入回收站失败时保留原文件：笔记会在下次加载时"复活"，
        // 这比静默丢失数据安全得多。
        console.warn('Failed to move note to trash, keeping original file:', relPath, e.message);
      }
    }

    // Write folder metadata
    await this.writeMeta(folders);

    // Update index
    this.fileIndex = newFileIndex;
  }
}

module.exports = {
  vaultFileStore: new VaultFileStore(),
};
