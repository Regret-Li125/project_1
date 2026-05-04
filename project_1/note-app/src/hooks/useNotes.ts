import { useState, useEffect, useCallback, useRef } from 'react';
import type { Note, Folder } from '../types/note';
import { notesApi } from '../api/notesApi';
import { lifecycleApi } from '../api/lifecycleApi';

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [storageError, setStorageError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ notes: Note[]; folders?: Folder[] } | null>(null);
  const foldersRef = useRef(folders);
  const toastRef = useRef<{ error: (msg: string) => void } | null>(null);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  // Load notes on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const { notes: loadedNotes, folders: loadedFolders } = await notesApi.loadNotes();
        setNotes(loadedNotes);
        setFolders(loadedFolders);
      } catch (error) {
        console.error('Failed to load data:', error);
        setStorageError('加载数据失败');
      }
    };
    loadData();
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pendingSave = pendingSaveRef.current;
    if (!pendingSave) return;
    pendingSaveRef.current = null;
    const result = await notesApi.saveNotes(
      pendingSave.notes,
      pendingSave.folders || foldersRef.current
    );
    if (!result.success) {
      throw new Error(result.error || '保存失败');
    }
  }, []);

  const saveNotes = useCallback(async (updatedNotes: Note[], updatedFolders?: Folder[]) => {
    setSaveStatus('saving');
    pendingSaveRef.current = { notes: updatedNotes, folders: updatedFolders };

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      if (!pendingSaveRef.current) return;
      const { notes: notesToSave, folders: foldersToSave } = pendingSaveRef.current;
      pendingSaveRef.current = null;

      try {
        const result = await notesApi.saveNotes(notesToSave, foldersToSave || foldersRef.current);
        if (result.success) {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } else {
          setSaveStatus('error');
          if (result.error) {
            setStorageError(result.error);
            toastRef.current?.error('保存失败，请稍后重试');
          }
        }
      } catch {
        setSaveStatus('error');
        setStorageError('保存失败');
        toastRef.current?.error('保存失败，请稍后重试');
      }
    }, 500);
  }, []);

  const saveNotesImmediate = useCallback(async (updatedNotes: Note[], updatedFolders?: Folder[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;

    setSaveStatus('saving');
    try {
      const result = await notesApi.saveNotes(updatedNotes, updatedFolders || foldersRef.current);
      if (result.success) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
        if (result.error) setStorageError(result.error);
      }
    } catch {
      setSaveStatus('error');
      setStorageError('保存失败');
    }
  }, []);

  // Flush on close
  useEffect(() => {
    return lifecycleApi.onRequestClose(async () => {
      try {
        await flushPendingSave();
      } catch (error) {
        console.error('Failed to flush notes before close:', error);
      } finally {
        await lifecycleApi.confirmClose();
      }
    });
  }, [flushPendingSave]);

  const createBlankNote = useCallback((overrides: Partial<Note> = {}): Note => {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
      title: '',
      content: '',
      tags: [],
      folderId: null,
      path: '',
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      lastReviewedAt: null,
      ...overrides,
    };
  }, []);

  return {
    notes,
    setNotes,
    folders,
    setFolders,
    saveStatus,
    storageError,
    saveNotes,
    saveNotesImmediate,
    createBlankNote,
    toastRef,
  };
}
