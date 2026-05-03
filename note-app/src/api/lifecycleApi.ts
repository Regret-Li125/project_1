type LifecycleApi = {
  onRequestClose: (callback: () => void | Promise<void>) => () => void;
  confirmClose: () => Promise<{ success: boolean; error?: string }>;
};

declare global {
  interface Window {
    lifecycleApi?: LifecycleApi;
  }
}

export const lifecycleApi: LifecycleApi = {
  onRequestClose: (callback) => {
    if (window.lifecycleApi) {
      return window.lifecycleApi.onRequestClose(callback);
    }
    return () => undefined;
  },

  confirmClose: async () => {
    if (window.lifecycleApi) {
      return window.lifecycleApi.confirmClose();
    }
    return { success: true };
  },
};
