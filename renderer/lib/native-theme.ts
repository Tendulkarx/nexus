/** Mirrors the shape returned by the main process's `nativeTheme:getInfo` handler. */
export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "light" | "dark";
}
