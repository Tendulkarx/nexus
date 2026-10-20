/**
 * Renderer-side event names shared between AppShell/CommandPalette (which
 * dispatch them) and ConnectionManagerView (which owns the corresponding
 * dialogs' open/closed state). Kept in their own module to avoid a circular
 * import between the two.
 */
export const NEW_CONNECTION_EVENT = "nexus:new-connection";
export const NEW_FOLDER_EVENT = "nexus:new-folder";
export const OPEN_PALETTE_EVENT = "nexus:open-palette";

/**
 * Dispatched (with `detail: { profileId }`) by the shell's Sessions sidebar to
 * connect a saved profile. ConnectionManagerView stays mounted and owns the
 * connect flow, so the password prompt and error toasts live in one place.
 */
export const CONNECT_PROFILE_EVENT = "nexus:connect-profile";

export interface ConnectProfileEventDetail {
  profileId: string;
}

/**
 * File › Split Right / Split Down (⌘D / ⇧⌘D). Handled by whichever
 * TerminalTabs is visible in the active session tab.
 */
export const SPLIT_TERMINAL_EVENT = "nexus:split-terminal";

export interface SplitTerminalEventDetail {
  direction: "horizontal" | "vertical";
}
