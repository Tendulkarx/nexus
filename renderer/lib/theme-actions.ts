export async function toggleTheme(): Promise<void> {
  const info = await window.nexusAPI.nativeTheme.getInfo();
  await window.nexusAPI.nativeTheme.setThemeSource(info.shouldUseDarkColors ? "light" : "dark");
}
