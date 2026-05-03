import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setMessages((prev) => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setMessages((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string) => addToast('success', message), [addToast]);
  const error = useCallback((message: string) => addToast('error', message, 5000), [addToast]);
  const info = useCallback((message: string) => addToast('info', message), [addToast]);
  const loading = useCallback((message: string) => addToast('loading', message, 0), [addToast]);

  return {
    messages,
    addToast,
    dismissToast,
    success,
    error,
    info,
    loading,
  };
}
