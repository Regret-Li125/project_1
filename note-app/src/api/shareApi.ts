type ShareServerResult = {
  success: boolean;
  port?: number;
  ipAddress?: string;
  url?: string;
  localUrl?: string;
  error?: string;
};

type ShareServerStatus = {
  isRunning: boolean;
  port: number | null;
  url: string | null;
  localUrl: string | null;
};

type ShareApi = {
  startLocalServer: (exportPath: string) => Promise<ShareServerResult>;
  stopLocalServer: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<ShareServerStatus>;
};

declare global {
  interface Window {
    shareApi: ShareApi;
  }
}

export const shareApi: ShareApi = {
  startLocalServer: async (exportPath: string) => {
    if (window.shareApi) {
      return window.shareApi.startLocalServer(exportPath);
    }
    return { success: false, error: 'Share API not available' };
  },

  stopLocalServer: async () => {
    if (window.shareApi) {
      return window.shareApi.stopLocalServer();
    }
    return { success: false, error: 'Share API not available' };
  },

  getStatus: async () => {
    if (window.shareApi) {
      return window.shareApi.getStatus();
    }
    return { isRunning: false, port: null, url: null, localUrl: null };
  },
};
