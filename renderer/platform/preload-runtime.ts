import { contextBridge, ipcRenderer as electronIpc, webUtils } from "electron";

export { contextBridge };

export const ipcRenderer = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    electronIpc.invoke(channel, ...args) as Promise<T>,

  onNotification: (channel: string, callback: (params: unknown) => void): (() => void) => {
    const listener = (_e: unknown, params: unknown) => callback(params);
    electronIpc.on(channel, listener as Parameters<typeof electronIpc.on>[1]);
    return () => electronIpc.off(channel, listener as Parameters<typeof electronIpc.off>[1]);
  },

  isConnected: (): boolean => true,

  waitForReady: (): Promise<void> => Promise.resolve(),

  disconnect: (): void => {
    /* no persistent socket under electron */
  },
};

export function createWebUtilsAPI() {
  return {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  };
}
