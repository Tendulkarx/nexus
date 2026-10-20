import type { ComponentType } from "react";
import { RadarIcon, NetworkIcon, DiffIcon, FolderTreeIcon, BeerIcon, CalendarClockIcon } from "lucide-react";
import { PortScannerTool } from "./port-scanner";
import { NetworkScannerTool } from "./network-scanner";
import { DiffTool } from "./diff-tool";
import { FolderCompareTool } from "./folder-compare";
import { HomebrewTool } from "./homebrew-tool";
import { CronTool } from "./cron-tool";
import type { ToolId } from "./tool-tabs";

export const TOOL_ICONS: Record<ToolId, ComponentType<{ className?: string }>> = {
  "port-scanner": RadarIcon,
  "network-scanner": NetworkIcon,
  diff: DiffIcon,
  "folder-compare": FolderTreeIcon,
  homebrew: BeerIcon,
  cron: CalendarClockIcon,
};

const TOOL_COMPONENTS: Record<ToolId, ComponentType> = {
  "port-scanner": PortScannerTool,
  "network-scanner": NetworkScannerTool,
  diff: DiffTool,
  "folder-compare": FolderCompareTool,
  homebrew: HomebrewTool,
  cron: CronTool,
};

export function ToolView({ id }: { id: ToolId }) {
  const Tool = TOOL_COMPONENTS[id];
  return <Tool />;
}
