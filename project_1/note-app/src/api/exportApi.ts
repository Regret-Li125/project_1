import type { Note, Folder } from '../types/note';

type ExportResult = {
  success: boolean;
  path?: string;
  size?: number;
  error?: string;
};

type ExportApi = {
  selectDirectory: () => Promise<string | null>;
  selectSaveFile: (defaultName: string) => Promise<string | null>;
  exportMarkdownZip: (
    notes: Note[],
    folders: Folder[],
    savePath: string
  ) => Promise<ExportResult>;
  exportHtmlZip: (
    notes: Note[],
    folders: Folder[],
    savePath: string
  ) => Promise<ExportResult>;
  exportMarkdownDirectory: (
    notes: Note[],
    folders: Folder[],
    exportPath: string
  ) => Promise<ExportResult>;
  exportHtmlDirectory: (
    notes: Note[],
    folders: Folder[],
    exportPath: string
  ) => Promise<ExportResult>;
};

declare global {
  interface Window {
    exportApi: ExportApi;
  }
}

export const exportApi: ExportApi = {
  selectDirectory: async () => {
    if (window.exportApi) {
      return window.exportApi.selectDirectory();
    }
    return null;
  },

  selectSaveFile: async (defaultName: string) => {
    if (window.exportApi) {
      return window.exportApi.selectSaveFile(defaultName);
    }
    return null;
  },

  exportMarkdownZip: async (notes, folders, savePath) => {
    if (window.exportApi) {
      return window.exportApi.exportMarkdownZip(notes, folders, savePath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportHtmlZip: async (notes, folders, savePath) => {
    if (window.exportApi) {
      return window.exportApi.exportHtmlZip(notes, folders, savePath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportMarkdownDirectory: async (notes, folders, exportPath) => {
    if (window.exportApi) {
      return window.exportApi.exportMarkdownDirectory(notes, folders, exportPath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportHtmlDirectory: async (notes, folders, exportPath) => {
    if (window.exportApi) {
      return window.exportApi.exportHtmlDirectory(notes, folders, exportPath);
    }
    return { success: false, error: 'Export API not available' };
  },
};
