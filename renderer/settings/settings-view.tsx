import { useState, useEffect } from "react";
import {
  Button,
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Text,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  toast,
} from "@renderer/lib/ui";
import type { NativeThemeInfo } from "@renderer/lib/native-theme";
import type { AiSuggestConfig } from "@shared/ipc-contract";
import { ipc } from "@renderer/lib/ipc";

function AiSuggestSettings() {
  const [config, setConfig] = useState<AiSuggestConfig | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ipc.settings
      .getAiSuggestConfig()
      .then((c) => {
        setConfig(c);
        setEndpoint(c.endpoint);
        setModel(c.model);
      })
      .catch((error) => toast.error(`Failed to load AI suggestion settings: ${error}`));
  }, []);

  async function save(patch: Partial<{ enabled: boolean }>) {
    setSaving(true);
    try {
      const next = await ipc.settings.setAiSuggestConfig({
        enabled: patch.enabled ?? config?.enabled ?? false,
        endpoint,
        model,
        apiKey: apiKey ? apiKey : undefined,
      });
      setConfig(next);
      setApiKey("");
      toast.success("AI suggestion settings saved");
    } catch (error) {
      toast.error(`Failed to save AI suggestion settings: ${error}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FieldSet title="AI Terminal Suggestions">
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="ai-enabled">Enabled</FieldLabel>
            <Text variant="small" color="tertiary">
              Off by default. Sends the current partial command (and a little recent history) to your own
              endpoint below — never anywhere else.
            </Text>
          </FieldContent>
          <Label className="cursor-pointer" htmlFor="ai-enabled">
            <Checkbox
              id="ai-enabled"
              checked={config?.enabled ?? false}
              onCheckedChange={(checked) => void save({ enabled: checked === true })}
            />
          </Label>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="ai-endpoint">Endpoint</FieldLabel>
          </FieldContent>
          <Input
            id="ai-endpoint"
            placeholder="https://api.example.com/v1/chat/completions"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="ai-model">Model</FieldLabel>
          </FieldContent>
          <Input id="ai-model" placeholder="gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="ai-key">API Key</FieldLabel>
            <Text variant="small" color="tertiary">
              {config?.hasApiKey ? "A key is stored securely." : "No key stored yet."}
            </Text>
          </FieldContent>
          <Input
            id="ai-key"
            type="password"
            placeholder={config?.hasApiKey ? "Enter a new key to replace it" : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent />
          <Button variant="accent" disabled={saving} onClick={() => void save({})}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}

export function SettingsView() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper]")) {
        return;
      }

      event.preventDefault();
      window.nexusAPI.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const refreshThemeInfo = async () => {
    try {
      const info = await window.nexusAPI.nativeTheme.getInfo();
      setThemeInfo(info);
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshThemeInfo();
  }, []);

  const handleThemeChange = async (value: string) => {
    const source = value as "system" | "light" | "dark";
    try {
      await window.nexusAPI.nativeTheme.setThemeSource(source);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Settings</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
      }
    >
      <div className="px-4 flex flex-col gap-8 mb-8">
        <FieldSet>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="theme">Theme</FieldLabel>
              </FieldContent>
              <RadioGroup
                value={themeInfo?.themeSource ?? "system"}
                onValueChange={handleThemeChange}
                orientation="horizontal"
              >
                <Label>
                  <RadioGroupItem value="system" />
                  Auto
                </Label>
                <Label>
                  <RadioGroupItem value="light" />
                  Light
                </Label>
                <Label>
                  <RadioGroupItem value="dark" />
                  Dark
                </Label>
              </RadioGroup>
            </Field>
          </FieldGroup>
        </FieldSet>

        <AiSuggestSettings />
      </div>
    </ScrollArea>
  );
}
