/**
 * Split-pane layout for one terminal tab: a row ("horizontal") or column
 * ("vertical") of up to MAX_PANES shells. One direction per tab keeps the
 * model flat; the first split picks it. Pure, so the rules are unit tested
 * (terminal-layout.test.ts) apart from React.
 */
export type SplitDirection = "horizontal" | "vertical";

export interface TabLayout {
  panes: string[];
  direction: SplitDirection;
  /** The pane that last had focus; new panes open next to it. */
  active: string;
}

export const MAX_PANES = 4;

export function singlePane(id: string): TabLayout {
  return { panes: [id], direction: "horizontal", active: id };
}

export function canSplit(layout: TabLayout, direction: SplitDirection): boolean {
  if (layout.panes.length >= MAX_PANES) return false;
  return layout.panes.length === 1 || layout.direction === direction;
}

/** Inserts `newId` right after the active pane and focuses it; unchanged if the split isn't allowed. */
export function splitPane(layout: TabLayout, direction: SplitDirection, newId: string): TabLayout {
  if (!canSplit(layout, direction)) return layout;
  const at = layout.panes.indexOf(layout.active) + 1;
  const panes = [...layout.panes.slice(0, at), newId, ...layout.panes.slice(at)];
  return { panes, direction, active: newId };
}

/** Removes a pane, focusing its neighbour; null when it was the last one (the tab should close). */
export function closePane(layout: TabLayout, paneId: string): TabLayout | null {
  const index = layout.panes.indexOf(paneId);
  if (index < 0) return layout;
  const panes = layout.panes.filter((p) => p !== paneId);
  if (panes.length === 0) return null;
  const active = layout.active === paneId ? panes[Math.min(index, panes.length - 1)] : layout.active;
  return { ...layout, panes, active };
}
