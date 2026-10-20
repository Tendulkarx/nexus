/**
 * Persists app-level (not per-connection) user settings: opt-in AI
 * terminal-suggestions config, the native-notifications toggle and the theme. The AI
 * suggestion API key is encrypted with the same CredentialVault used for
 * connection secrets and never sent to the renderer in plaintext.
 */
import { DataStore } from "./data-store.js";
import { credentialVault } from "./credential-vault.js";

import { applyPreferencesPatch, normalizePreferences, type AppPreferences } from "../../renderer/shared/preferences.js";

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
  /** Optional so files saved before this setting existed still parse; treated as enabled when absent. */
  notificationsEnabled?: boolean;
  /** Settings-window preferences; stored as saved and normalized on every read (see shared/preferences.ts). */
  preferences?: unknown;
  /** Appearance (Auto/Light/Dark), applied to nativeTheme at startup so menus and windows match. Absent = Auto. */
  themeSource?: ThemeSource;
}

export type ThemeSource = "system" | "light" | "dark";

const DEFAULT_FILE: AppSettingsFile = {
  aiSuggest: { enabled: false, endpoint: "", model: "", apiKeySecret: null },
  notificationsEnabled: true,
};

export class AppSettingsStore {
  private store = new DataStore<AppSettingsFile>("app-settings.json", DEFAULT_FILE);
  private preferenceListeners = new Set<(prefs: AppPreferences) => void>();

  /** Called after every preferences change (the app menu rebuilds its shortcuts from it). */
  onPreferencesChanged(listener: (prefs: AppPreferences) => void): () => void {
    this.preferenceListeners.add(listener);
    return () => this.preferenceListeners.delete(listener);
  }

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

  async getPreferences(): Promise<AppPreferences> {
    const data = await this.store.load();
    return normalizePreferences(data.preferences);
  }

  /** Merges a (possibly partial, untrusted) patch into the saved preferences and returns the result. */
  async updatePreferences(patch: unknown): Promise<AppPreferences> {
    const data = await this.store.load();
    const next = applyPreferencesPatch(normalizePreferences(data.preferences), patch);
    data.preferences = next;
    await this.store.save(data);
    for (const listener of this.preferenceListeners) listener(next);
    return next;
  }

  async getNotificationsEnabled(): Promise<boolean> {
    const data = await this.store.load();
    return data.notificationsEnabled ?? true;
  }

  async setNotificationsEnabled(enabled: boolean): Promise<boolean> {
    const data = await this.store.load();
    data.notificationsEnabled = enabled;
    await this.store.save(data);
    return enabled;
  }

  async getThemeSource(): Promise<ThemeSource> {
    const data = await this.store.load();
    return data.themeSource === "light" || data.themeSource === "dark" ? data.themeSource : "system";
  }

  async setThemeSource(source: ThemeSource): Promise<void> {
    const data = await this.store.load();
    data.themeSource = source;
    await this.store.save(data);
  }
}

export const appSettingsStore = new AppSettingsStore();
