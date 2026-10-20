/**
 * Shared frame for tool tabs: title row, a form row, an optional progress
 * bar, and a scrolling results area.
 */
import type { ReactNode } from "react";
import { cn } from "@renderer/lib/cn";

interface ToolLayoutProps {
  title: string;
  description: string;
  form: ReactNode;
  /** 0–1 while something is running; omit to hide the bar. */
  progress?: number;
  status?: ReactNode;
  children: ReactNode;
}

export function ToolLayout({ title, description, form, progress, status, children }: ToolLayoutProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-separator shrink-0 flex flex-col gap-3">
        <div>
          <h1 className="text-base font-semibold text-primary">{title}</h1>
          <p className="text-xs text-secondary">{description}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">{form}</div>
        {(progress !== undefined || status) && (
          <div className="flex items-center gap-3 text-xs text-secondary">
            {progress !== undefined && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-1.5 w-48 rounded-full bg-control overflow-hidden"
              >
                <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            {status}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs text-secondary", className)}>
      {label}
      {children}
    </label>
  );
}

/** Plain results table with a sticky header; `columns` are header labels. */
export function ResultsTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-[var(--bg)] text-left text-xs text-secondary">
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col" className="px-5 py-2 font-medium border-b border-separator">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function EmptyResults({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-secondary">{children}</p>;
}
