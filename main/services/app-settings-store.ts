/**
 * Persists app-level (not per-connection) user settings. Currently just the
 * opt-in AI terminal-suggestions config; the user's API key is encrypted with
 * the same CredentialVault used for connection secrets and never sent to the
 * renderer in plaintext.
 */
import { DataStore } from "./data-store.js";
import { credentialVault } from "./credential-vault.js";

import type { AiSuggestConfig, AiSuggestConfigInput } from "@shared/ipc-contract";

interface AiSuggestSettings {
  enabled: boolean;
  endpoint: string;
  model: string;
  /** safeStorage-encrypted base64. NEVER sent to renderer. */
  apiKeySecret: string | null;
}

interface AppSettingsFile {
  aiSuggest: AiSuggestSettings;
}

const DEFAULT_FILE: AppSettingsFile = {
  aiSuggest: { enabled: false, endpoint: "", model: "", apiKeySecret: null },
};

export class AppSettingsStore {
  private store = new DataStore<AppSettingsFile>("app-settings.json", DEFAULT_FILE);

  async getAiSuggestConfig(): Promise<AiSuggestConfig> {
    const data = await this.store.load();
    const { enabled, endpoint, model, apiKeySecret } = data.aiSuggest;
    return { enabled, endpoint, model, hasApiKey: Boolean(apiKeySecret) };
  }

  async setAiSuggestConfig(input: AiSuggestConfigInput): Promise<AiSuggestConfig> {
    const data = await this.store.load();
    const apiKeySecret =
      input.apiKey === undefined
        ? data.aiSuggest.apiKeySecret // leave unchanged
        : input.apiKey === null || input.apiKey === ""
          ? null // explicit clear
          : await credentialVault.encrypt(input.apiKey);

    data.aiSuggest = { enabled: input.enabled, endpoint: input.endpoint, model: input.model, apiKeySecret };
    await this.store.save(data);
    return { enabled: input.enabled, endpoint: input.endpoint, model: input.model, hasApiKey: Boolean(apiKeySecret) };
  }

  /** Backend-only: the decrypted key, for the AI completion service to use. Null when unset/enabled=false/decryption fails. */
  async getDecryptedApiKey(): Promise<string | null> {
    const data = await this.store.load();
    if (!data.aiSuggest.enabled || !data.aiSuggest.apiKeySecret) return null;
    return credentialVault.decrypt(data.aiSuggest.apiKeySecret);
  }
}

export const appSettingsStore = new AppSettingsStore();
