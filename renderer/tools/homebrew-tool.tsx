/**
 * Homebrew: installed and outdated packages, search, and install / upgrade /
 * uninstall with brew's output shown live underneath. One job at a time; the
 * lists refresh when it finishes. Uninstall asks first.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { AlertDialog, Badge, Button, Input } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { BrewAction, BrewKind, BrewPackage } from "@shared/ipc-contract";
import { ToolLayout, ResultsTable, EmptyResults } from "./tool-layout";
import { cleanIpcError } from "./use-scan";

type View = "installed" | "outdated" | "search";

interface Job {
  id: string | null;
  label: string;
  log: string;
  /** Set when brew has finished. */
  result: { ok: boolean; text: string } | null;
}

const ACTION_VERB: Record<BrewAction, string> = {
  install: "Installing",
  upgrade: "Upgrading",
  uninstall: "Uninstalling",
};

export function HomebrewTool() {
  const qc = useQueryClient();
  const [view, setView] = React.useState<View>("installed");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<BrewPackage[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<BrewPackage | null>(null);
  const [showDependencies, setShowDependencies] = React.useState(false);
  const logRef = React.useRef<HTMLPreElement>(null);

  const status = useQuery({ queryKey: ["brew-status"], queryFn: () => ipc.tools.brewStatus() });
  const installed = useQuery({
    queryKey: ["brew-installed"],
    queryFn: () => ipc.tools.brewInstalled(),
    enabled: status.data?.installed === true,
  });

  // Output and completion arrive as events; only one job runs, so every event belongs to it.
  React.useEffect(() => {
    const offOutput = ipc.tools.onBrewOutput(({ chunk }) =>
      setJob((j) => (j && !j.result ? { ...j, log: j.log + chunk } : j)),
    );
    const offDone = ipc.tools.onBrewDone(({ code, error: err }) => {
      setJob((j) =>
        j
          ? {
              ...j,
              result:
                code === 0
                  ? { ok: true, text: "Done." }
                  : { ok: false, text: err ?? (code === null ? "Stopped." : `brew exited with code ${code}.`) },
            }
          : j,
      );
      void qc.invalidateQueries({ queryKey: ["brew-installed"] });
    });
    return () => {
      offOutput();
      offDone();
    };
  }, [qc]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  const running = job !== null && job.result === null;

  async function run(action: BrewAction, kind: BrewKind, names: string[], label: string) {
    setJob({ id: null, label, log: "", result: null });
    try {
      const { jobId } = await ipc.tools.brewStart({ action, kind, names });
      setJob((j) => (j ? { ...j, id: jobId } : j));
    } catch (err) {
      setJob({
        id: null,
        label,
        log: "",
        result: { ok: false, text: cleanIpcError(err instanceof Error ? err.message : String(err)) },
      });
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setView("search");
    try {
      setResults(await ipc.tools.brewSearch({ query }));
    } catch (err) {
      setError(cleanIpcError(err instanceof Error ? err.message : String(err)));
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  const all = installed.data ?? [];
  const outdated = all.filter((p) => p.outdated);
  const rows =
    view === "search"
      ? (results ?? [])
      : view === "outdated"
        ? outdated
        : all.filter((p) => showDependencies || !p.dependency);
  // Search results come back without "installed" info for some names; fill it from the installed list.
  const installedByName = new Map(all.map((p) => [`${p.kind}:${p.name}`, p]));

  if (status.data && !status.data.installed) {
    return (
      <ToolLayout title="Homebrew" description="Install and update command-line tools and apps." form={null}>
        <EmptyResults>
          Homebrew isn&apos;t installed on this Mac. Get it from{" "}
          <a className="text-accent underline" href="https://brew.sh" target="_blank" rel="noreferrer">
            brew.sh
          </a>
          , then reopen this tab.
        </EmptyResults>
      </ToolLayout>
    );
  }

  const tab = (id: View, label: string, count?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => setView(id)}
      className={cn(
        "h-7 px-3 rounded-[6px] text-xs transition-colors",
        view === id ? "bg-[var(--bg)] text-primary shadow-sm" : "text-secondary hover:text-primary",
      )}
    >
      {label}
      {count !== undefined && <span className="ml-1 text-tertiary">{count}</span>}
    </button>
  );

  return (
    <ToolLayout
      title="Homebrew"
      description={
        status.data?.version ? `Homebrew ${status.data.version}` : "Install and update command-line tools and apps."
      }
      form={
        <>
          <form onSubmit={search} className="flex items-center gap-2">
            <Input
              placeholder="Search packages, e.g. htop"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search Homebrew"
              className="w-64"
            />
            <Button type="submit" variant="filled" disabled={searching || !query.trim()}>
              <SearchIcon className="size-3.5 mr-1" />
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>
          <div role="tablist" aria-label="Packages" className="flex rounded-medium bg-control-subtle p-0.5">
            {tab("installed", "Installed", installed.data ? all.filter((p) => !p.dependency).length : undefined)}
            {tab("outdated", "Updates", installed.data ? outdated.length : undefined)}
            {tab("search", "Search results", results?.length)}
          </div>
          <Button
            variant="transparent"
            iconOnly
            aria-label="Reload installed packages"
            onClick={() => void installed.refetch()}
            disabled={installed.isFetching}
          >
            <RefreshCwIcon className={cn("size-4", installed.isFetching && "animate-spin")} />
          </Button>
          {view === "outdated" && outdated.length > 0 && (
            <Button
              variant="accent"
              disabled={running}
              onClick={() => void run("upgrade", "formula", [], "Upgrading everything")}
            >
              Upgrade all
            </Button>
          )}
          {view === "installed" && (
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input
                type="checkbox"
                checked={showDependencies}
                onChange={(e) => setShowDependencies(e.target.checked)}
              />
              Show dependencies
            </label>
          )}
        </>
      }
      status={error ? <span className="text-support-red">{error}</span> : undefined}
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0 overflow-auto">
          {(view !== "search" && installed.isLoading) || (view === "search" && searching) ? (
            <EmptyResults>{view === "search" ? "Searching…" : "Reading installed packages…"}</EmptyResults>
          ) : installed.error && view !== "search" ? (
            <EmptyResults>{cleanIpcError(installed.error.message)}</EmptyResults>
          ) : rows.length === 0 ? (
            <EmptyResults>
              {view === "search"
                ? results
                  ? "No packages match."
                  : "Search for a package to install."
                : view === "outdated"
                  ? "Everything is up to date. Homebrew's package list updates when you run brew update."
                  : "Nothing installed yet."}
            </EmptyResults>
          ) : (
            <ResultsTable columns={["Package", "Version", "Description", ""]}>
              {rows.map((p) => {
                const local = installedByName.get(`${p.kind}:${p.name}`);
                const installedVersion = p.installedVersion ?? local?.installedVersion ?? null;
                const isOutdated = p.outdated || local?.outdated === true;
                return (
                  <tr key={`${p.kind}:${p.name}`} className="border-b border-separator last:border-b-0 align-top">
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-primary">{p.name}</span>
                        {p.kind === "cask" && <Badge color="purple">App</Badge>}
                        {p.dependency && <Badge color="secondary">Dependency</Badge>}
                        {p.pinned && <Badge color="secondary">Pinned</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-secondary whitespace-nowrap">
                      {installedVersion ?? p.latestVersion ?? ""}
                      {isOutdated && p.latestVersion && installedVersion !== p.latestVersion && (
                        <span className="text-support-yellow"> → {p.latestVersion}</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs text-secondary">{p.description}</td>
                    <td className="px-5 py-2 text-right whitespace-nowrap">
                      {installedVersion ? (
                        <div className="flex justify-end gap-1.5">
                          {isOutdated && !p.pinned && (
                            <Button
                              size="small"
                              variant="accent"
                              disabled={running}
                              onClick={() => void run("upgrade", p.kind, [p.name], `${ACTION_VERB.upgrade} ${p.name}`)}
                            >
                              Upgrade
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant="transparent"
                            disabled={running}
                            onClick={() => setConfirmRemove(p)}
                          >
                            Uninstall
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="small"
                          variant="filled"
                          disabled={running}
                          onClick={() => void run("install", p.kind, [p.name], `${ACTION_VERB.install} ${p.name}`)}
                        >
                          Install
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </ResultsTable>
          )}
        </div>

        {job && (
          <div className="terminal-surface shrink-0 border-t border-separator">
            <div className="flex items-center gap-2 px-5 py-1.5 text-xs">
              <span className="font-medium text-primary flex-1" role="status">
                {job.label}
                {job.result ? (
                  <span className={cn("ml-2", job.result.ok ? "text-support-green" : "text-support-red")}>
                    {job.result.text}
                  </span>
                ) : (
                  "…"
                )}
              </span>
              {running && job.id && (
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => void ipc.tools.brewCancel({ jobId: job.id! })}
                >
                  Stop
                </Button>
              )}
              {!running && (
                <Button size="small" variant="transparent" onClick={() => setJob(null)}>
                  Close
                </Button>
              )}
            </div>
            <pre
              ref={logRef}
              aria-label="brew output"
              className="h-44 overflow-auto px-5 pb-2 font-mono text-[11px] leading-4 whitespace-pre-wrap"
              style={{ color: "#f8f8f2" }}
            >
              {job.log || "Waiting for brew…"}
            </pre>
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        title={`Uninstall ${confirmRemove?.name}?`}
        description={
          confirmRemove?.kind === "cask"
            ? "This removes the app from /Applications. Its settings stay, so reinstalling picks them up again."
            : "Anything that needs it will stop working until it's installed again. Homebrew refuses if another formula depends on it."
        }
        confirmLabel="Uninstall"
        confirmVariant="destructive"
        onConfirm={() => {
          const p = confirmRemove;
          if (p) void run("uninstall", p.kind, [p.name], `${ACTION_VERB.uninstall} ${p.name}`);
        }}
      />
    </ToolLayout>
  );
}
