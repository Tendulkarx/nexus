/**
 * xterm colours: the ob_dark palette (Warp's ob_dark.yaml, the user's
 * canonical terminal theme). The surrounding chrome uses the same background
 * via the `.terminal-surface` class in styles.css — keep the two in sync.
 *
 * Two quirks are deliberate, not typos: ANSI white is a red-orange
 * (#DF2935) because prompt themes style the username as "white bold", and the
 * "bright" row is darker Solarized tones. That second one is why
 * drawBoldTextInBrightColors is off in terminal-pane.tsx — otherwise bold text
 * would switch to the muted bright colours.
 */
import type { ITheme } from "@xterm/xterm";

export const OB_DARK_THEME: ITheme = {
  background: "#182028",
  foreground: "#f8f8f2",
  cursor: "#8be9fd",
  cursorAccent: "#182028",
  selectionBackground: "#8be9fd55",
  black: "#073642",
  red: "#dc322f",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#8be9fd",
  white: "#df2935",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};
