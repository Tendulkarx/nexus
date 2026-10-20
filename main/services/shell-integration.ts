/**
 * Shell hook typed into every freshly-opened SSH/SFTP terminal (see
 * terminal-service.ts's open()) so bash/zsh emit OSC 7
 * (`ESC ]7;file://host/path ESC \`) on every prompt — terminal-pane.tsx
 * listens for it via xterm's registerOscHandler(7, ...) to drive the file
 * browser's remote pane to follow the shell's cwd. It only defines the hook
 * for $ZSH_VERSION/$BASH_VERSION shells; anything else (fish, tcsh, a
 * restricted/nologin shell) just sees unrecognized input and ignores it, so
 * the terminal keeps working normally without cwd-following.
 *
 * Typed input is echoed back (by the tty before the shell starts, then again
 * by zsh/bash's line editor), so the hook is one line, and it ends by printing
 * READY_MARKER. terminal-service.ts holds the terminal's output until it sees
 * the marker and drops everything from the first echo to it (stripInjectedEcho),
 * so the user sees their banner and a fresh prompt, not the hook. The leading
 * space keeps it out of history where HIST_IGNORE_SPACE / ignorespace is set.
 */
const OSC7_HOOK_LINE = [
  'if [ -n "$ZSH_VERSION" ]; then',
  '__nexus_osc7() { printf \'\\033]7;file://%s%s\\033\\\\\' "$HOST" "$PWD"; };',
  "autoload -Uz add-zsh-hook >/dev/null 2>&1 && add-zsh-hook precmd __nexus_osc7;",
  'elif [ -n "$BASH_VERSION" ]; then',
  '__nexus_osc7() { printf \'\\033]7;file://%s%s\\033\\\\\' "$HOSTNAME" "$PWD"; };',
  'PROMPT_COMMAND="__nexus_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}";',
  "fi;",
  "printf '\\033]777;nexus-ready\\007'",
].join(" ");

export const OSC7_SHELL_INTEGRATION_SNIPPET = ` ${OSC7_HOOK_LINE}`;

/** What the hook prints when it has run. An OSC xterm ignores, should one ever slip through. */
export const READY_MARKER = "\x1b]777;nexus-ready\x07";

/** Start of the hook as echoed; it never appears in real output otherwise. */
const ECHO_START = 'if [ -n "$ZSH_VERSION" ]';

/**
 * Given a terminal's output since the hook was typed, returns it with the
 * echoed hook removed, or null while the marker hasn't arrived yet. Everything
 * from the first echo (the tty's, which comes before the shell's first prompt)
 * through the marker goes, so that first prompt goes too; the shell prints a
 * new one straight after the marker.
 */
export function stripInjectedEcho(held: string): string | null {
  const marker = held.indexOf(READY_MARKER);
  if (marker === -1) return null;
  const after = held.slice(marker + READY_MARKER.length);
  let start = held.indexOf(ECHO_START);
  if (start === -1 || start > marker) return held.slice(0, marker) + after;
  if (held[start - 1] === " ") start -= 1;
  return held.slice(0, start) + after;
}
