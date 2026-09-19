/**
 * Opt-in terminal command suggestions. Talks to a user-supplied
 * OpenAI-compatible chat completions endpoint using the user's own API key —
 * never bundled, never called unless the user has enabled the feature and
 * provided both an endpoint and a key (see AppSettingsStore). Deliberately
 * isolated to this one module: nothing else in the app depends on it, and it
 * is not yet wired into the terminal UI (see CLAUDE.md-adjacent report notes
 * on scope for this feature).
 */
import { logger } from "../logger.js";

import { appSettingsStore } from "./app-settings-store.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SUGGESTION_TOKENS = 40;

/**
 * Suggests a completion for `partialCommand`, given a little recent shell
 * history for context. Returns null whenever a suggestion isn't available —
 * feature disabled, no key configured, or the request itself failed — never
 * throws, since a failed suggestion should be invisible to the user typing.
 */
export async function suggestCommand(partialCommand: string, recentHistory: string[]): Promise<string | null> {
  const config = await appSettingsStore.getAiSuggestConfig();
  if (!config.enabled || !config.endpoint) return null;

  const apiKey = await appSettingsStore.getDecryptedApiKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || undefined,
        max_tokens: MAX_SUGGESTION_TOKENS,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You complete a single partially-typed shell command. Reply with ONLY the remainder of the " +
              "command (no explanation, no markdown, no leading whitespace). If you have nothing useful to " +
              "add, reply with an empty string.",
          },
          {
            role: "user",
            content:
              (recentHistory.length > 0 ? `Recent commands:\n${recentHistory.join("\n")}\n\n` : "") +
              `Partial command: ${partialCommand}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn("ai-completion-service", "Suggestion request failed", { status: response.status });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const suggestion = data.choices?.[0]?.message?.content?.trim();
    return suggestion || null;
  } catch (err) {
    logger.warn("ai-completion-service", "Suggestion request errored", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
