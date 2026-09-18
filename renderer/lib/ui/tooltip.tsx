import type { ReactNode } from "react";
import { Tooltip as Rx } from "radix-ui";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Rx.Provider delayDuration={400}>{children}</Rx.Provider>;
}
