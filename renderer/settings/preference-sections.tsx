/**
 * Settings sections backed by AppPreferences (shared/preferences.ts): every
 * change is saved through updatePreferences(), which validates it in main and
 * pushes the result to every window, so open terminals and viewers update
 * immediately.
 */
import * as React from "react";
import { FolderOpenIcon, PlusIcon, TrashIcon, RotateCcwIcon } from "lucide-react";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Text,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  toast,
} from "@renderer/lib/ui";
import { usePreferences, updatePreferences } from "@renderer/lib/preferences";
import {
  DEFAULT_HIGHLIGHT_RULES,
  isUsablePattern,
  PREFERENCE_LIMITS,
  terminalFontStack,
  type AppPreferences,
  type HighlightRule,
  type PreferencesPatch,
} from "@shared/preferences";
import {
  acceleratorFromEvent,
  conflictingActions,
  DEFAULT_SHORTCUTS,
  formatAccelerator,
  isValidAccelerator,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from "@shared/shortcuts";
import { compileRules, findHighlights } from "@renderer/workspace/terminal/highlighter";
import { cn } from "@renderer/lib/cn";

function save(patch: PreferencesPatch) {
  void updatePreferences(patch).catch((err) =>
    toast.error(`Couldn't save: ${err instanceof Error ? err.message : err}`),
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Field orientation="horizontal">
      <FieldContent className="flex-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint && (
          <Text variant="small" color="tertiary">
            {hint}
          </Text>
        )}
      </FieldContent>
      <div className="shrink-0">{children}</div>
    </Field>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="cursor-pointer" htmlFor={id}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </Label>
  );
}

/** Text/number input that saves on blur or Enter, not on every keystroke. */
function CommitInput({
  id,
  value,
  onCommit,
  type = "text",
  className,
  placeholder,
  ...rest
}: {
  id: string;
  value: string | number;
  onCommit: (v: string) => void;
  type?: "text" | "number";
  className?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** id of a <datalist> with suggestions. */
  list?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft !== String(value)) onCommit(draft);
  };
  return (
    <Input
      id={id}
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={className}
      {...rest}
    />
  );
}

/** Path input with a Choose… button and a way back to the default (empty). */
function PathPicker({
  id,
  value,
  placeholder,
  pick,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  pick: "file" | "folder";
  onChange: (v: string) => void;
}) {
  async function choose() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      properties: pick === "folder" ? ["openDirectory", "createDirectory"] : ["openFile", "showHiddenFiles"],
    });
    const chosen = result.filePaths[0];
    if (!result.canceled && chosen) onChange(chosen);
  }
  return (
    <div className="flex items-center gap-1.5">
      <CommitInput id={id} value={value} placeholder={placeholder} onCommit={onChange} className="w-64" />
      <Button variant="filled" iconOnly aria-label={`Choose ${pick}`} onClick={() => void choose()}>
        <FolderOpenIcon className="size-4" />
      </Button>
      {value && (
        <Button variant="transparent" size="small" onClick={() => onChange("")}>
          Default
        </Button>
      )}
    </div>
  );
}

const FONT_SUGGESTIONS = [
  "RobotoMono Nerd Font Mono",
  "JetBrainsMono Nerd Font Mono",
  "MesloLGS Nerd Font Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Fira Code",
];

export function TerminalSettings() {
  const t = usePreferences().terminal;
  const set = (patch: Partial<AppPreferences["terminal"]>) => save({ terminal: patch });
  return (
    <FieldGroup>
      <Row
        id="term-font"
        label="Font"
        hint="Nerd Fonts show prompt icons (Starship, powerlevel10k). Falls back to Menlo."
      >
        <CommitInput
          id="term-font"
          list="term-font-list"
          value={t.fontFamily}
          onCommit={(v) => set({ fontFamily: v })}
          className="w-64"
        />
        <datalist id="term-font-list">
          {FONT_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Row>
      <Row id="term-size" label="Font size">
        <CommitInput
          id="term-size"
          type="number"
          value={t.fontSize}
          min={PREFERENCE_LIMITS.fontSize.min}
          max={PREFERENCE_LIMITS.fontSize.max}
          onCommit={(v) => set({ fontSize: Number(v) })}
          className="w-20"
        />
      </Row>
      <Row id="term-line" label="Line height">
        <CommitInput
          id="term-line"
          type="number"
          step={0.05}
          value={t.lineHeight}
          min={PREFERENCE_LIMITS.lineHeight.min}
          max={PREFERENCE_LIMITS.lineHeight.max}
          onCommit={(v) => set({ lineHeight: Number(v) })}
          className="w-20"
        />
      </Row>
      <div
        className="terminal-surface my-2 rounded-medium px-3 py-2"
        style={{ fontFamily: terminalFontStack(t.fontFamily), fontSize: t.fontSize, lineHeight: t.lineHeight }}
        aria-label="Font preview"
      >
        <span style={{ color: "#50fa7b" }}>oneil@pve-01</span>
        <span style={{ color: "#93a1a1" }}>:</span>
        <span style={{ color: "#8be9fd" }}>~</span>$ ls -la /etc
      </div>
      <Row id="term-cursor" label="Cursor">
        <Select
          value={t.cursorStyle}
          onValueChange={(v) => set({ cursorStyle: v as AppPreferences["terminal"]["cursorStyle"] })}
        >
          <SelectTrigger id="term-cursor" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
            <SelectItem value="underline">Underline</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row id="term-blink" label="Blinking cursor">
        <Toggle id="term-blink" checked={t.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
      </Row>
      <Row id="term-scrollback" label="Scrollback" hint="Lines kept above the screen.">
        <CommitInput
          id="term-scrollback"
          type="number"
          step={1000}
          value={t.scrollback}
          min={PREFERENCE_LIMITS.scrollback.min}
          max={PREFERENCE_LIMITS.scrollback.max}
          onCommit={(v) => set({ scrollback: Number(v) })}
          className="w-28"
        />
      </Row>
      <Row id="term-copy" label="Copy on select" hint="Selecting text in a terminal copies it to the clipboard.">
        <Toggle id="term-copy" checked={t.copyOnSelect} onChange={(v) => set({ copyOnSelect: v })} />
      </Row>
    </FieldGroup>
  );
}

export function SessionSettings() {
  const { sessions: s, localShell: l } = usePreferences();
  return (
    <FieldGroup>
      <Row id="ssh-opens" label="SSH sessions open on" hint="SFTP and FTP sessions always open on Files.">
        <Select
          value={s.sshOpensOn}
          onValueChange={(v) => save({ sessions: { sshOpensOn: v as AppPreferences["sessions"]["sshOpensOn"] } })}
        >
          <SelectTrigger id="ssh-opens" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="terminal">Terminal</SelectItem>
            <SelectItem value="files">Files</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row
        id="ssh-keepalive"
        label="Keepalive (seconds)"
        hint="Stops idle SSH sessions being dropped by routers. 0 turns it off. Applies to new connections."
      >
        <CommitInput
          id="ssh-keepalive"
          type="number"
          value={s.keepaliveSeconds}
          min={PREFERENCE_LIMITS.keepaliveSeconds.min}
          max={PREFERENCE_LIMITS.keepaliveSeconds.max}
          onCommit={(v) => save({ sessions: { keepaliveSeconds: Number(v) } })}
          className="w-20"
        />
      </Row>
      <Row
        id="multi-warn"
        label="Warn before multi-exec"
        hint="Ask the first time a terminal starts sending its typing to other sessions."
      >
        <Toggle
          id="multi-warn"
          checked={s.warnBeforeMultiExec}
          onChange={(v) => save({ sessions: { warnBeforeMultiExec: v } })}
        />
      </Row>
      <Row id="local-shell" label="Local shell" hint="Leave empty for your login shell.">
        <PathPicker
          id="local-shell"
          pick="file"
          value={l.shell}
          placeholder="Login shell ($SHELL)"
          onChange={(v) => save({ localShell: { shell: v } })}
        />
      </Row>
      <Row id="local-dir" label="Local shell starts in">
        <PathPicker
          id="local-dir"
          pick="folder"
          value={l.startDir}
          placeholder="Home folder"
          onChange={(v) => save({ localShell: { startDir: v } })}
        />
      </Row>
    </FieldGroup>
  );
}

export function FileSettings() {
  const f = usePreferences().files;
  return (
    <FieldGroup>
      <Row
        id="download-dir"
        label="Downloads go to"
        hint="Used by the Files sidebar, which has no local pane to drop into."
      >
        <PathPicker
          id="download-dir"
          pick="folder"
          value={f.downloadDir}
          placeholder="~/Downloads"
          onChange={(v) => save({ files: { downloadDir: v } })}
        />
      </Row>
    </FieldGroup>
  );
}

export function RemoteDesktopSettings() {
  const r = usePreferences().remoteDesktop;
  const set = (patch: Partial<AppPreferences["remoteDesktop"]>) => save({ remoteDesktop: patch });
  return (
    <FieldGroup>
      <Row
        id="vnc-fit"
        label="Fit to window"
        hint="VNC viewers start scaled to fit. Toggle per viewer from its toolbar."
      >
        <Toggle id="vnc-fit" checked={r.vncFitToWindow} onChange={(v) => set({ vncFitToWindow: v })} />
      </Row>
      <Row id="vnc-view" label="Start in view-only mode" hint="Watch without sending your keyboard and mouse.">
        <Toggle id="vnc-view" checked={r.vncViewOnly} onChange={(v) => set({ vncViewOnly: v })} />
      </Row>
      <Row
        id="vnc-clip"
        label="Share clipboard"
        hint="Copy remote text to this Mac, and allow Send clipboard. Off keeps the clipboards separate."
      >
        <Toggle id="vnc-clip" checked={r.vncShareClipboard} onChange={(v) => set({ vncShareClipboard: v })} />
      </Row>
    </FieldGroup>
  );
}

const HIGHLIGHT_SAMPLE = "nginx: [warn] conflicting server name on 10.0.10.11:443\nsshd: Connection refused, then OK";

/** The sample text with the rules applied, the way a terminal shows it. */
function HighlightPreview({ rules }: { rules: HighlightRule[] }) {
  const compiled = compileRules(rules);
  return (
    <div
      className="terminal-surface my-2 rounded-medium px-3 py-2 font-mono text-xs leading-5"
      aria-label="Highlight preview"
    >
      {HIGHLIGHT_SAMPLE.split("\n").map((line, i) => {
        // Later rules win where matches overlap, as in the terminal.
        const colors: (string | undefined)[] = [];
        for (const m of findHighlights(line, compiled)) for (let k = m.start; k < m.end; k++) colors[k] = m.color;
        const spans: { text: string; color?: string }[] = [];
        [...line].forEach((ch, k) => {
          const last = spans[spans.length - 1];
          if (last && last.color === colors[k]) last.text += ch;
          else spans.push({ text: ch, color: colors[k] });
        });
        return (
          <div key={i} style={{ color: "#f8f8f2" }}>
            {spans.map((sp, k) => (
              <span key={k} style={sp.color ? { color: sp.color } : undefined}>
                {sp.text}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function HighlightRuleRow({
  index,
  rule,
  onChange,
  onRemove,
}: {
  index: number;
  rule: HighlightRule;
  onChange: (rule: HighlightRule) => void;
  onRemove: () => void;
}) {
  const [pattern, setPattern] = React.useState(rule.pattern);
  React.useEffect(() => setPattern(rule.pattern), [rule.pattern]);
  const valid = isUsablePattern(pattern);
  const commit = () => {
    if (valid && pattern !== rule.pattern) onChange({ ...rule, pattern });
  };
  return (
    <div className="flex items-center gap-2 py-1.5">
      <input
        type="color"
        value={rule.color}
        onChange={(e) => onChange({ ...rule, color: e.target.value })}
        aria-label={`Colour for rule ${index + 1}`}
        className="size-7 shrink-0 cursor-pointer rounded border border-separator bg-transparent p-0.5"
      />
      <Input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        aria-label={`Pattern for rule ${index + 1}`}
        aria-invalid={!valid}
        className={cn("flex-1 min-w-0 font-mono text-xs", !valid && "border-support-red")}
      />
      <Button variant="transparent" size="small" iconOnly onClick={onRemove} aria-label={`Remove rule ${index + 1}`}>
        <TrashIcon className="size-3.5 text-secondary" />
      </Button>
    </div>
  );
}

export function HighlightSettings() {
  const h = usePreferences().highlight;
  const setRules = (rules: HighlightRule[]) => save({ highlight: { rules } });
  return (
    <FieldGroup>
      <Row
        id="hl-enabled"
        label="Highlight terminal output"
        hint="Colours matching words as they appear. Full-screen apps like vim and htop are left alone."
      >
        <Toggle id="hl-enabled" checked={h.enabled} onChange={(v) => save({ highlight: { enabled: v } })} />
      </Row>
      <HighlightPreview rules={h.enabled ? h.rules : []} />
      <div className="flex flex-col">
        <Text variant="small" color="tertiary">
          Each pattern is a regular expression, matched without regard to case. \b marks a word boundary. Later rules
          win where two overlap.
        </Text>
        {h.rules.map((rule, i) => (
          <HighlightRuleRow
            key={i}
            index={i}
            rule={rule}
            onChange={(next) => setRules(h.rules.map((r, k) => (k === i ? next : r)))}
            onRemove={() => setRules(h.rules.filter((_, k) => k !== i))}
          />
        ))}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="filled"
            size="small"
            disabled={h.rules.length >= PREFERENCE_LIMITS.highlightRules}
            onClick={() => setRules([...h.rules, { pattern: "\\bchangeme\\b", color: "#bd93f9" }])}
          >
            <PlusIcon className="size-3.5 mr-1" />
            Add rule
          </Button>
          <Button variant="transparent" size="small" onClick={() => setRules(DEFAULT_HIGHLIGHT_RULES)}>
            <RotateCcwIcon className="size-3.5 mr-1" />
            Restore defaults
          </Button>
        </div>
      </div>
    </FieldGroup>
  );
}

/** A shortcut button: click it, then press the new key combination (Esc cancels, Delete clears). */
function ShortcutRecorder({
  action,
  label,
  value,
  conflict,
}: {
  action: ShortcutAction;
  label: string;
  value: string;
  conflict: boolean;
}) {
  const [recording, setRecording] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      setHint(null);
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      save({ shortcuts: { [action]: "" } });
      setRecording(false);
      setHint(null);
      return;
    }
    const accelerator = acceleratorFromEvent(e.nativeEvent);
    if (!accelerator) return; // still holding modifiers
    if (!isValidAccelerator(accelerator)) {
      setHint("Include ⌘, ⌃ or ⌥ so it doesn't get in the way of typing.");
      return;
    }
    save({ shortcuts: { [action]: accelerator } });
    setRecording(false);
    setHint(null);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`Shortcut for ${label}`}
        aria-pressed={recording}
        onClick={() => setRecording((r) => !r)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setRecording(false);
          setHint(null);
        }}
        className={cn(
          "min-w-24 rounded-medium border px-2 py-1 font-sans text-xs transition-colors",
          recording
            ? "border-accent bg-accent/10 text-accent"
            : conflict
              ? "border-support-red text-support-red"
              : "border-separator text-primary hover:bg-control-subtle",
        )}
      >
        {recording ? "Press keys…" : value ? formatAccelerator(value) : "None"}
      </button>
      {hint && (
        <Text variant="small" color="tertiary">
          {hint}
        </Text>
      )}
    </div>
  );
}

export function ShortcutSettings() {
  const shortcuts = usePreferences().shortcuts;
  const conflicts = conflictingActions(shortcuts);
  return (
    <FieldGroup>
      <Text variant="small" color="tertiary">
        Click a shortcut, then press the new keys. Esc cancels; Delete removes the shortcut.
      </Text>
      <table className="w-full text-sm">
        <tbody>
          {SHORTCUT_ACTIONS.map(({ id, label }) => (
            <tr key={id} className="border-b border-separator last:border-b-0">
              <td className="py-2 text-primary">
                {label}
                {conflicts.has(id) && (
                  <Text variant="small" className="block text-support-red">
                    Same as another shortcut
                  </Text>
                )}
              </td>
              <td className="py-2 text-right">
                <ShortcutRecorder action={id} label={label} value={shortcuts[id]} conflict={conflicts.has(id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <Button variant="transparent" size="small" onClick={() => save({ shortcuts: DEFAULT_SHORTCUTS })}>
          <RotateCcwIcon className="size-3.5 mr-1" />
          Restore defaults
        </Button>
      </div>
    </FieldGroup>
  );
}
