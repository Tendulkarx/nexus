/**
 * Nexus Preload Script
 *
 * Runs before renderer code and sets up the secure bridge between the
 * renderer and the main process via `contextBridge`/`ipcRenderer`.
 *
 * SECURITY MODEL:
 * - This is the ONLY file that should import from "electron" on the renderer side.
 * - Renderer code should ONLY access window.nexusAPI.
 * - We never expose ipcRenderer directly — only specific, controlled channels.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent, OpenDialogOptions, OpenDialogReturnValue } from "electron";
import type { NativeThemeInfo } from "./lib/native-theme";

interface PopupMenuItem {
  label?: string;
  commandId?: number;
  type?: "separator";
}
interface PopupMenuOptions {
  items: PopupMenuItem[];
}
interface PopupMenuResult {
  commandId: number | null;
}

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

const nexusAPI = {
  dialog: {
    showOpenDialog: (options?: OpenDialogOptions): Promise<OpenDialogReturnValue> =>
      ipcRenderer.invoke("dialog:showOpenDialog", options),
  },

  webUtils: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  nativeTheme: {
    getInfo: (): Promise<NativeThemeInfo> => ipcRenderer.invoke("nativeTheme:getInfo"),
    setThemeSource: (source: "system" | "light" | "dark"): Promise<boolean> =>
      ipcRenderer.invoke("nativeTheme:setThemeSource", source),
  },

  Menu: {
    popup: (options: PopupMenuOptions): Promise<PopupMenuResult> => ipcRenderer.invoke("Menu:popup", options),
  },

  ipc: {
    /** Invoke a backend handler and wait for the result. */
    invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args),

    /** Fire-and-forget message to a main-process listener registered with ipcMain.on(). */
    send: (channel: string, ...args: unknown[]): void => ipcRenderer.send(channel, ...args),

    on: (channel: string, callback: IpcListener): (() => void) => {
      ipcRenderer.on(channel, callback);
      return () => ipcRenderer.removeListener(channel, callback);
    },

    once: (channel: string, callback: IpcListener): (() => void) => {
      ipcRenderer.once(channel, callback);
      return () => ipcRenderer.removeListener(channel, callback);
    },
  },
};

contextBridge.exposeInMainWorld("nexusAPI", nexusAPI);

export type NexusAPI = typeof nexusAPI;
