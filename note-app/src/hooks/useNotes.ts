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
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ notes: Note[]; folders?: Folder[] } | null>(null);
  const foldersRef = useRef(folders);
  const notesRef = useRef(notes);
  const toastRef = useRef<{ error: (msg: string) => void } | null>(null);
  // 保存串行化队列：所有 notes:save 都挂在该 promise 链上依次执行，杜绝并发写
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // 当前在途（或最近一次入队）的保存 promise，resolve 值表示是否成功
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  // 初次加载状态：加载完成前入队的保存会先等待加载结束，避免与 load resolve 竞争
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const loadDoneRef = useRef(false);
  // 加载期间是否发生过编辑（用于决定 load resolve 时是否丢弃旧快照）
  const editedDuringLoadRef = useRef(false);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // 保存成功后延迟复位状态指示；定时器存 ref，重复设置前先清除，卸载时清理
  const scheduleIdleReset = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      setSaveStatus('idle');
    }, 2000);
  }, []);

  // 将一次保存挂到串行队列尾部执行；返回的 promise resolve 为是否成功（永不 reject）
  const enqueueSave = useCallback((notesToSave: Note[], foldersToSave?: Folder[]): Promise<boolean> => {
    const task = async (): Promise<boolean> => {
      // 初次加载尚未结束时，先等待加载完成再写盘，避免保存与 load resolve 互相覆盖
      if (!loadDoneRef.current && loadPromiseRef.current) {
        try {
          await loadPromiseRef.current;
        } catch {
          // 加载失败不阻塞保存
        }
      }
      setSaveStatus('saving');
      try {
        const result = await notesApi.saveNotes(notesToSave, foldersToSave || foldersRef.current);
        if (result.success) {
          setSaveStatus('saved');
          // 保存成功后清除错误横幅，避免旧的错误提示永久残留
          setStorageError(null);
          scheduleIdleReset();
          return true;
        }
        setSaveStatus('error');
        setStorageError(result.error || '保存失败');
        toastRef.current?.error('保存失败，请稍后重试');
        return false;
      } catch {
        setSaveStatus('error');
        setStorageError('保存失败');
        toastRef.current?.error('保存失败，请稍后重试');
        return false;
      }
    };
    const run = saveQueueRef.current.then(task);
    saveQueueRef.current = run;
    inFlightSaveRef.current = run;
    return run;
  }, [scheduleIdleReset]);

  // Load notes on mount
  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      try {
        const result = await notesApi.loadNotes();
        if (cancelled) return;
        if (result.error) {
          setStorageError(result.error);
          return;
        }
        if (editedDuringLoadRef.current) {
          // 加载期间已有新增/编辑：磁盘上的快照是旧数据，直接覆盖会丢失新编辑。
          // 稳妥做法：保留内存中的新状态，并把当前状态重新入队保存，让最新数据落盘。
          enqueueSave(notesRef.current, foldersRef.current);
        } else {
          setNotes(result.notes);
          setFolders(result.folders);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load data:', error);
        setStorageError('加载数据失败');
      } finally {
        loadDoneRef.current = true;
      }
    };
    loadPromiseRef.current = loadData();
    return () => {
      cancelled = true;
    };
  }, [enqueueSave]);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    let ok = true;
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) {
      pendingSaveRef.current = null;
      // enqueueSave 返回的 promise 即为最新的在途保存，await 它即覆盖了在途等待
      ok = await enqueueSave(pendingSave.notes, pendingSave.folders);
    } else if (inFlightSaveRef.current) {
      // 无待保存项时，仍需等待在途保存完成，确保关窗前所有写入都已落盘
      ok = await inFlightSaveRef.current;
    }
    if (!ok) {
      throw new Error('保存失败');
    }
  }, [enqueueSave]);

  const saveNotes = useCallback((updatedNotes: Note[], updatedFolders?: Folder[]) => {
    if (!loadDoneRef.current) {
      editedDuringLoadRef.current = true;
    }
    pendingSaveRef.current = { notes: updatedNotes, folders: updatedFolders };

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pendingSave = pendingSaveRef.current;
      if (!pendingSave) return;
      pendingSaveRef.current = null;
      enqueueSave(pendingSave.notes, pendingSave.folders);
    }, 500);
  }, [enqueueSave]);

  const saveNotesImmediate = useCallback((updatedNotes: Note[], updatedFolders?: Folder[]): Promise<boolean> => {
    if (!loadDoneRef.current) {
      editedDuringLoadRef.current = true;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    return enqueueSave(updatedNotes, updatedFolders);
  }, [enqueueSave]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, []);

  // Flush on close
  useEffect(() => {
    return lifecycleApi.onRequestClose(async () => {
      try {
        await flushPendingSave();
      } catch (error) {
        // 保存失败：不确认关窗，提示用户保存失败并取消本次关闭
        console.error('Failed to flush notes before close:', error);
        setStorageError('保存失败，已取消关闭。请重试或检查存储后手动备份。');
        toastRef.current?.error('保存失败，已取消关闭窗口');
        return;
      }
      await lifecycleApi.confirmClose();
    });
  }, [flushPendingSave]);

  const createBlankNote = useCallback((overrides: Partial<Note> = {}): Note => {
    const now = new Date().toISOString();
    return {
      // 降级分支追加随机后缀，防止同一毫秒内生成重复 id
      id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
