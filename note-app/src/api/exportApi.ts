import type { Note, Folder, Attachment } from '../types/note';

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
    attachments: Attachment[],
    savePath: string
  ) => Promise<ExportResult>;
  exportHtmlZip: (
    notes: Note[],
    folders: Folder[],
    attachments: Attachment[],
    savePath: string
  ) => Promise<ExportResult>;
  exportMarkdownDirectory: (
    notes: Note[],
    folders: Folder[],
    attachments: Attachment[],
    exportPath: string
  ) => Promise<ExportResult>;
  exportHtmlDirectory: (
    notes: Note[],
    folders: Folder[],
    attachments: Attachment[],
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

  exportMarkdownZip: async (notes, folders, attachments, savePath) => {
    if (window.exportApi) {
      return window.exportApi.exportMarkdownZip(notes, folders, attachments, savePath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportHtmlZip: async (notes, folders, attachments, savePath) => {
    if (window.exportApi) {
      return window.exportApi.exportHtmlZip(notes, folders, attachments, savePath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportMarkdownDirectory: async (notes, folders, attachments, exportPath) => {
    if (window.exportApi) {
      return window.exportApi.exportMarkdownDirectory(notes, folders, attachments, exportPath);
    }
    return { success: false, error: 'Export API not available' };
  },

  exportHtmlDirectory: async (notes, folders, attachments, exportPath) => {
    if (window.exportApi) {
      return window.exportApi.exportHtmlDirectory(notes, folders, attachments, exportPath);
    }
    return { success: false, error: 'Export API not available' };
  },
};
