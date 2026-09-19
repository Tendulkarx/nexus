/**
 * IPC handlers for app-level settings (currently: opt-in AI terminal
 * suggestions) and the completion call itself.
 */
import { ipcMain } from "electron";

import { asRecord, reqString } from "./validate.js";
import { suggestCommand } from "../services/ai-completion-service.js";
import { appSettingsStore } from "../services/app-settings-store.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { AiSuggestConfig, AiSuggestConfigInput, AiSuggestResult } from "@shared/ipc-contract";

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settings.getAiSuggestConfig, async (): Promise<AiSuggestConfig> => {
    return appSettingsStore.getAiSuggestConfig();
  });

  ipcMain.handle(IPC.settings.setAiSuggestConfig, async (_e, payload: unknown): Promise<AiSuggestConfig> => {
    const obj = asRecord(payload, "settings:setAiSuggestConfig");
    const configObj = asRecord(obj.config, "settings:setAiSuggestConfig");
    const config: AiSuggestConfigInput = {
      enabled: Boolean(configObj.enabled),
      endpoint: typeof configObj.endpoint === "string" ? configObj.endpoint : "",
      model: typeof configObj.model === "string" ? configObj.model : "",
      apiKey: configObj.apiKey === undefined ? undefined : (configObj.apiKey as string | null),
    };
    return appSettingsStore.setAiSuggestConfig(config);
  });

  ipcMain.handle(IPC.ai.suggest, async (_e, payload: unknown): Promise<AiSuggestResult> => {
    const obj = asRecord(payload, "ai:suggest");
    const partialCommand = reqString(obj, "partialCommand", "ai:suggest");
    const recentHistory = Array.isArray(obj.recentHistory) ? (obj.recentHistory as string[]) : [];
    const suggestion = await suggestCommand(partialCommand, recentHistory);
    return { suggestion };
  });
}
