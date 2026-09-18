/**
 * Renderer-side event name shared between AppShell (which listens for
 * "menu:action" from the native app menu) and ConnectionManagerView (which
 * owns the "New Connection" dialog's open/closed state). Kept in its own
 * module to avoid a circular import between the two.
 */
export const NEW_CONNECTION_EVENT = "nexus:new-connection";
