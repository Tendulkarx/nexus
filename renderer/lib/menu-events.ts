/**
 * Renderer-side event names shared between AppShell/CommandPalette (which
 * dispatch them) and ConnectionManagerView (which owns the corresponding
 * dialogs' open/closed state). Kept in their own module to avoid a circular
 * import between the two.
 */
export const NEW_CONNECTION_EVENT = "nexus:new-connection";
export const NEW_FOLDER_EVENT = "nexus:new-folder";
