const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const yaml = require('js-yaml');

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
  }

  _ensureInitialized() {
    if (this._initialized) return;
    const baseDir = path.join(app.getPath('userData'), 'personal-knowledge-notes');
    this.vaultPath = path.join(baseDir, 'vault');
    this.metaPath = path.join(this.vaultPath, '.vault-meta.json');
    this.notesDir = path.join(this.vaultPath, 'notes');
    this.foldersDir = path.join(this.vaultPath, 'folders');
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

  async dirHasContent(dirPath) {
    try {
      const entries = await fs.readdir(dirPath);
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  // ── File name helpers ─────────────────────────────────────────────

  sanitizeFileName(title) {
    if (!title || !title.trim()) return 'untitled';
    let name = title.trim();
    name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    name = name.replace(/\s+/g, '_');
    name = name.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!name) name = 'untitled';
    if (name.length > 200) name = name.substring(0, 200);
    return name;
  }

  resolveUniquePath(targetDir, baseName, noteId, usedNames) {
    if (!usedNames.has(targetDir)) {
      usedNames.set(targetDir, new Set());
    }
    const dirNames = usedNames.get(targetDir);

    let candidate = baseName;
    if (dirNames.has(candidate.toLowerCase())) {
      const suffix = noteId.replace(/-/g, '').substring(0, 8);
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

  // ── Frontmatter helpers ───────────────────────────────────────────

  parseFrontmatter(text) {
    if (!text.startsWith('---')) {
      return { frontmatter: {}, content: text };
    }
    const endMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
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

  async readMdFile(absPath, fallbackFolderId) {
    const raw = await fs.readFile(absPath, 'utf-8');
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
    } catch {
      // Windows: rename fails if target exists; remove first then retry
      await fs.rm(absPath, { force: true });
      await fs.rename(tempPath, absPath);
    }
  }

  // ── Folder metadata helpers ───────────────────────────────────────

  async readMeta() {
    try {
      const raw = await fs.readFile(this.metaPath, 'utf-8');
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
      const data = await fs.readFile(this.legacyPath, 'utf-8');
      payload = this.parseLegacyPayload(data);
    } catch {
      // Primary file unreadable, try backup
    }
    if (!payload) {
      try {
        const backupData = await fs.readFile(this.legacyBackupPath, 'utf-8');
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

    for (const raw of payload.notes) {
      try {
        const note = {
          id: raw.id || crypto.randomUUID(),
          title: raw.title || '',
          content: raw.content || '',
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          folderId: raw.folderId || null,
          path: '',
          sourceType: raw.sourceType || 'manual',
          sourceUrl: raw.sourceUrl || undefined,
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || new Date().toISOString(),
          lastOpenedAt: raw.lastOpenedAt || null,
          lastReviewedAt: raw.lastReviewedAt || null,
        };

        const targetDir = note.folderId
          ? path.join(this.foldersDir, note.folderId)
          : this.notesDir;
        const baseName = this.sanitizeFileName(note.title);
        const absPath = this.resolveUniquePath(targetDir, baseName, note.id, usedNames);

        await this.writeMdFile(absPath, note);

        note.path = path.relative(this.vaultPath, absPath).replace(/\\/g, '/');
        this.fileIndex.set(note.id, note.path);
        notes.push(note);
        migrated++;
      } catch (e) {
        console.warn('Failed to migrate note:', raw.title, e.message);
      }
    }

    await this.writeMeta(payload.folders);

    // Rename legacy file to prevent re-migration
    try {
      await fs.rename(this.legacyPath, `${this.legacyPath}.migrated`);
    } catch (e) {
      console.warn('Failed to rename legacy notes.json:', e.message);
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

    const legacyExists = await this.fileExists(this.legacyPath);
    const vaultHasNotes = await this.dirHasContent(this.notesDir);
    const vaultHasFolders = await this.dirHasContent(this.foldersDir);

    if (legacyExists && !vaultHasNotes && !vaultHasFolders) {
      return await this.migrateFromLegacy();
    }

    if (!legacyExists && !vaultHasNotes && !vaultHasFolders) {
      return { notes: [], folders: [] };
    }

    return await this.loadFromVault();
  }

  async saveNotes(notes, folders = []) {
    this._ensureInitialized();
    await this.ensureDirectories();

    const newFileIndex = new Map();
    const incomingIds = new Set(notes.map((n) => n.id));
    const usedNames = new Map();

    // Create / update / move notes
    for (const note of notes) {
      const targetDir = note.folderId
        ? path.join(this.foldersDir, note.folderId)
        : this.notesDir;
      const baseName = this.sanitizeFileName(note.title);
      const desiredAbsPath = this.resolveUniquePath(targetDir, baseName, note.id, usedNames);
      const desiredRelPath = path.relative(this.vaultPath, desiredAbsPath).replace(/\\/g, '/');

      const currentRelPath = this.fileIndex.get(note.id);
      const currentAbsPath = currentRelPath
        ? path.join(this.vaultPath, currentRelPath)
        : null;

      if (!currentRelPath) {
        // CREATE
        await this.writeMdFile(desiredAbsPath, note);
      } else if (currentRelPath !== desiredRelPath) {
        // MOVE / RENAME
        try {
          await fs.rm(currentAbsPath, { force: true });
        } catch {
          // Old file may not exist
        }
        await this.writeMdFile(desiredAbsPath, note);
      } else {
        // UPDATE in place
        await this.writeMdFile(desiredAbsPath, note);
      }

      newFileIndex.set(note.id, desiredRelPath);
    }

    // DELETE notes no longer present
    for (const [noteId, relPath] of this.fileIndex) {
      if (!incomingIds.has(noteId)) {
        const absPath = path.join(this.vaultPath, relPath);
        try {
          await fs.rm(absPath, { force: true });
          // Clean up empty parent directory
          const parentDir = path.dirname(absPath);
          if (parentDir !== this.notesDir && parentDir !== this.foldersDir) {
            const remaining = await fs.readdir(parentDir).catch(() => []);
            if (remaining.length === 0) {
              await fs.rmdir(parentDir).catch(() => {});
            }
          }
        } catch {
          // File may already be gone
        }
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
