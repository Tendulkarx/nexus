import * as React from "react";
import { Button, Text } from "@glaze/core/components";
import { ChevronRightIcon, HomeIcon } from "lucide-react";

interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

function splitPath(path: string): { label: string; path: string }[] {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const segments = splitPath(path);

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto min-w-0">
      {/* Root / Home */}
      <Button
        variant="transparent"
        size="small"
        iconOnly
        onClick={() => onNavigate("/")}
        aria-label="Root"
      >
        <HomeIcon className="size-3.5 text-secondary" />
      </Button>

      {segments.map((seg, i) => (
        <React.Fragment key={seg.path}>
          <ChevronRightIcon className="size-3 text-quaternary shrink-0" />
          <Button
            variant="transparent"
            size="small"
            onClick={() => onNavigate(seg.path)}
            disabled={i === segments.length - 1}
            className="min-w-0 max-w-[120px]"
          >
            <Text variant="small" truncate color={i === segments.length - 1 ? "primary" : "secondary"}>
              {seg.label}
            </Text>
          </Button>
        </React.Fragment>
      ))}
    </div>
  );
}
