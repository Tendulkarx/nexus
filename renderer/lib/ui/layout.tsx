import * as React from "react";
import { PanelGroup as Rx, Panel as RxPanel, PanelResizeHandle } from "react-resizable-panels";
import { cn } from "../cn";
import { Input } from "./primitives";

// ── SplitView (persisted sidebar + main content) ────────────────────────

interface SplitViewProps {
  storageKey?: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function SplitView({ storageKey, sidebar, children }: SplitViewProps) {
  return (
    <Rx direction="horizontal" autoSaveId={storageKey} className="flex h-full">
      <RxPanel defaultSize={20} minSize={14} maxSize={40} className="min-w-0 border-r border-separator">
        {sidebar}
      </RxPanel>
      <PanelResizeHandle className="w-px bg-separator hover:bg-accent/50 transition-colors" />
      <RxPanel className="min-w-0">{children}</RxPanel>
    </Rx>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────

interface SidebarProps {
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function Sidebar({ searchable, searchPlaceholder, searchValue, onSearchChange, actions, children }: SidebarProps) {
  return (
    <div className="h-full flex flex-col bg-chrome">
      {/* drag-region + left padding clears the inset macOS traffic lights (trafficLightPosition x:16 in main/index.ts) */}
      <div className="drag-region flex items-center gap-1.5 p-2 pl-20 border-b border-separator shrink-0">
        {searchable && (
          <Input
            size="small"
            variant="filled"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="no-drag flex-1 min-w-0"
          />
        )}
      </div>
      {actions && (
        <div className="no-drag flex items-center gap-1.5 px-2 py-1.5 border-b border-separator shrink-0">
          {actions}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">{children}</div>
    </div>
  );
}

// ── SidebarList / SidebarListItem ───────────────────────────────────────

interface SidebarListContextValue<T> {
  selectedItem: T;
  onSelectedItemChange: (item: T) => void;
  getItemKey: (item: T) => string;
}

const SidebarListContext = React.createContext<SidebarListContextValue<any> | null>(null);

interface SidebarListProps<T> {
  items: T[];
  selectedItem: T;
  onSelectedItemChange: (item: T) => void;
  getItemKey: (item: T) => string;
  children: React.ReactNode;
}

export function SidebarList<T>({ selectedItem, onSelectedItemChange, getItemKey, children }: SidebarListProps<T>) {
  return (
    <SidebarListContext.Provider value={{ selectedItem, onSelectedItemChange, getItemKey }}>
      <div className="flex flex-col gap-0.5 px-1.5">{children}</div>
    </SidebarListContext.Provider>
  );
}

interface SidebarListItemProps<T> {
  item: T;
  icon?: React.ReactNode;
  title: string;
  accessory?: React.ReactNode;
}

export function SidebarListItem<T>({ item, icon, title, accessory }: SidebarListItemProps<T>) {
  const ctx = React.useContext(SidebarListContext);
  if (!ctx) return null;
  const selected = ctx.getItemKey(ctx.selectedItem) === ctx.getItemKey(item);
  return (
    <button
      type="button"
      onClick={() => ctx.onSelectedItemChange(item)}
      className={cn(
        "flex items-center gap-2 rounded-medium px-2 py-1.5 text-sm text-left transition-colors",
        selected ? "bg-accent/15 text-accent" : "text-secondary hover:bg-control-subtle hover:text-primary",
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 min-w-0 truncate">{title}</span>
      {accessory}
    </button>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  placement?: "center" | "top";
}

export function EmptyState({ title, description, actions, placement = "center" }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 p-8 text-center",
        placement === "center" ? "h-full justify-center" : "justify-start",
      )}
    >
      <p className="text-sm font-medium text-primary">{title}</p>
      {description && <p className="text-xs text-secondary max-w-xs">{description}</p>}
      {actions && <div className="mt-2">{actions}</div>}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────

export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-toolbar
      className={cn(
        // pl-20 clears the inset macOS traffic lights (trafficLightPosition x:16 in main/index.ts)
        "drag-region flex items-center justify-between gap-2 border-b border-separator bg-chrome pl-20 pr-3 py-2 shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function ToolbarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("no-drag flex items-center gap-1", className)} {...props} />;
}

export function ToolbarTitle({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-sm font-semibold text-primary truncate", className)} {...props} />;
}

export function ToolbarDescription({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-xs text-secondary truncate", className)} {...props} />;
}

export function ToolbarActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("no-drag flex items-center gap-1", className)} {...props} />;
}

// ── Field / FieldSet ─────────────────────────────────────────────────────

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  description?: string;
  orientation?: "horizontal" | "vertical";
}

export function Field({ label, description, orientation = "vertical", className, children, ...props }: FieldProps) {
  return (
    <div
      className={cn(
        "flex gap-2 py-2",
        orientation === "horizontal" ? "flex-row items-center" : "flex-col",
        className,
      )}
      {...props}
    >
      {label ? (
        <>
          <FieldContent className={orientation === "horizontal" ? "w-32 shrink-0" : undefined}>
            <FieldLabel>{label}</FieldLabel>
            {description && <p className="text-xs text-tertiary">{description}</p>}
          </FieldContent>
          <div className="flex-1 min-w-0">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

export function FieldContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function FieldGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm text-primary", className)} {...props} />;
}

interface FieldSetProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function FieldSet({ title, className, children, ...props }: FieldSetProps) {
  return (
    <div className={cn("flex flex-col border-b border-separator pb-2 mb-2 last:border-b-0", className)} {...props}>
      {title && <p className="text-xs font-semibold text-tertiary uppercase tracking-wide mb-1 mt-2">{title}</p>}
      {children}
    </div>
  );
}
