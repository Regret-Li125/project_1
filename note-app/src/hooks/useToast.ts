import { useCallback, useMemo, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

/** 同时展示的最大 toast 条数，超出时丢弃最旧的一条 */
const MAX_TOASTS = 5;

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setMessages((prev) => {
      // 限制最大同时条数：超出时丢弃最旧的，避免 toast 堆积刷屏
      const trimmed = prev.length >= MAX_TOASTS ? prev.slice(prev.length - MAX_TOASTS + 1) : prev;
      return [...trimmed, { id, type, message, duration }];
    });
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setMessages((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string) => addToast('success', message), [addToast]);
  const error = useCallback((message: string) => addToast('error', message, 5000), [addToast]);
  const info = useCallback((message: string) => addToast('info', message), [addToast]);
  /**
   * 显示 loading toast（duration 为 0，不会自动消失）。
   * 调用方必须保存返回的 id，并在操作结束后配对调用 dismissToast(id)，
   * 否则该 toast 会一直停留并占用展示槽位。
   */
  const loading = useCallback((message: string) => addToast('loading', message, 0), [addToast]);

  return useMemo(() => ({
    messages,
    addToast,
    dismissToast,
    success,
    error,
    info,
    loading,
  }), [messages, addToast, dismissToast, success, error, info, loading]);
}
