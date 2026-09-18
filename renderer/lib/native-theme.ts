/** Mirrors the shape returned by the main process's `nativeTheme:getInfo` handler. */
export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "light" | "dark";
}

export async function toggleTheme(): Promise<void> {
  const info = await window.nexusAPI.nativeTheme.getInfo();
  await window.nexusAPI.nativeTheme.setThemeSource(info.shouldUseDarkColors ? "light" : "dark");
}
