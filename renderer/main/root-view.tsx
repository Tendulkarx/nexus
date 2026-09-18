import { Outlet } from "@tanstack/react-router";
import { useTheme } from "@renderer/lib/hooks";

export function RootView() {
  useTheme();

  return (
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
      <Outlet />
    </div>
  );
}
