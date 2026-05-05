const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

class NotesFileStore {
  constructor() {
    this.storagePath = path.join(app.getPath('userData'), 'personal-knowledge-notes', 'notes.json');
    this.backupPath = `${this.storagePath}.bak`;
    this.tempPath = `${this.storagePath}.tmp`;
  }

  getStoragePath() {
    return this.storagePath;
  }

  async ensureDirectory() {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
  }

  parsePayload(data) {
    const parsed = JSON.parse(data);

    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return { notes: [], folders: [] };
    }

    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  }

  async loadNotes() {
    try {
      await this.ensureDirectory();
      const data = await fs.readFile(this.storagePath, 'utf-8');
      return this.parsePayload(data);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { notes: [], folders: [] };
      }
      console.error('Failed to load notes:', error);

      try {
        const backupData = await fs.readFile(this.backupPath, 'utf-8');
        return this.parsePayload(backupData);
      } catch (backupError) {
        console.error('Failed to load backup notes:', backupError);
        return { notes: [], folders: [] };
      }
    }
  }

  async saveNotes(notes, folders = []) {
    await this.ensureDirectory();
    const payload = JSON.stringify({ version: 1, notes, folders }, null, 2);

    try {
      const existingData = await fs.readFile(this.storagePath, 'utf-8');
      this.parsePayload(existingData);
      await fs.writeFile(this.backupPath, existingData, 'utf-8');
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        console.warn('Failed to create notes backup:', error);
      }
    }

    try {
      await fs.writeFile(this.tempPath, payload, 'utf-8');
      await fs.rename(this.tempPath, this.storagePath);
    } catch (error) {
      try {
        await fs.rm(this.tempPath, { force: true });
      } catch {
        // Ignore cleanup failure; the next save will overwrite the temp file.
      }
      throw error;
    }
  }
}

module.exports = {
  notesFileStore: new NotesFileStore(),
};
