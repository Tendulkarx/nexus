/**
 * Shell hook injected into every freshly-opened SSH/SFTP terminal (see
 * ssh-terminal-service.ts's open()) so bash/zsh emit OSC 7
 * (`ESC ]7;file://host/path ESC \`) on every prompt — terminal-pane.tsx
 * listens for it via xterm's registerOscHandler(7, ...) to drive the file
 * browser's remote pane to follow the shell's cwd. It only defines the hook
 * for $ZSH_VERSION/$BASH_VERSION shells; anything else (fish, tcsh, a
 * restricted/nologin shell) just sees unrecognized input and ignores it, so
 * the terminal keeps working normally without cwd-following.
 */
const OSC7_HOOK_LINES = [
  'if [ -n "$ZSH_VERSION" ]; then',
  "  __nexus_osc7() { printf '\\033]7;file://%s%s\\033\\\\' \"$HOST\" \"$PWD\"; }",
  "  autoload -Uz add-zsh-hook >/dev/null 2>&1 && add-zsh-hook precmd __nexus_osc7",
  'elif [ -n "$BASH_VERSION" ]; then',
  "  __nexus_osc7() { printf '\\033]7;file://%s%s\\033\\\\' \"$HOSTNAME\" \"$PWD\"; }",
  '  PROMPT_COMMAND="__nexus_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  "fi",
];

export const OSC7_SHELL_INTEGRATION_SNIPPET = OSC7_HOOK_LINES.join("\n");
