/**
 * Cron: a user crontab on this Mac or on an open SSH connection, as a list of
 * jobs with their schedule in words and next run times. Edits stay local until
 * Save, which replaces the crontab in one go (refused if it changed on the
 * machine since it was loaded). Parsing and round-tripping live in
 * shared/crontab.ts; lines that aren't jobs are kept as they were.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, PencilIcon, PlusIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import {
  AlertDialog,
  Button,
  Dialog,
  Field as FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { CronTarget, CronTabResult } from "@shared/ipc-contract";
import {
  addJob,
  describeSchedule,
  formatWallClock,
  isValidSchedule,
  nextRuns,
  parseCrontab,
  parseWallClock,
  removeJob,
  serializeCrontab,
  updateJob,
  type CronJob,
  type CronLine,
} from "@shared/crontab";
import { ToolLayout, Field, ResultsTable, EmptyResults } from "./tool-layout";
import { cleanIpcError } from "./use-scan";

const LOCAL = "local";

const PRESETS: { label: string; schedule: string }[] = [
  { label: "Every 5 minutes", schedule: "*/5 * * * *" },
  { label: "Every hour", schedule: "0 * * * *" },
  { label: "Every day at 05:00", schedule: "0 5 * * *" },
  { label: "Weekdays at 09:00", schedule: "0 9 * * 1-5" },
  { label: "Every Sunday at 03:00", schedule: "0 3 * * 0" },
  { label: "First of the month", schedule: "0 0 1 * *" },
  { label: "When the machine starts", schedule: "@reboot" },
];

interface Loaded {
  target: CronTarget;
  result: CronTabResult;
}

/** Add/edit form: schedule (with presets), live description and next runs, command. */
function JobDialog({
  job,
  clock,
  onSave,
  onClose,
}: {
  job: Pick<CronJob, "schedule" | "command"> | null;
  clock: ReturnType<typeof parseWallClock>;
  onSave: (schedule: string, command: string) => void;
  onClose: () => void;
}) {
  const [schedule, setSchedule] = React.useState(job?.schedule ?? "0 5 * * *");
  const [command, setCommand] = React.useState(job?.command ?? "");
  const valid = isValidSchedule(schedule);
  const runs = valid && clock ? nextRuns(schedule, clock, 3) : [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={job ? "Edit job" : "New job"} size="medium">
      <form
        className="flex flex-col gap-3 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && command.trim()) onSave(schedule.trim(), command.trim());
        }}
      >
        <FormField label="Schedule" description="Minute, hour, day of month, month, day of week. Or @daily, @reboot…">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              aria-invalid={!valid}
              className={cn("flex-1 font-mono", !valid && "border-support-red")}
            />
            <Select value="" onValueChange={setSchedule}>
              <SelectTrigger className="w-40" aria-label="Common schedules">
                <SelectValue placeholder="Common…" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.schedule} value={p.schedule}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FormField>
        <p className={cn("text-xs", valid ? "text-secondary" : "text-support-red")} role="status">
          {valid ? describeSchedule(schedule) : "That isn't a valid cron schedule."}
          {runs.length > 0 && clock && (
            <span className="block text-tertiary">
              Next: {runs.map((r) => formatWallClock(r, clock.year)).join(" · ")}
            </span>
          )}
        </p>
        <FormField label="Command" description="Runs under /bin/sh with a minimal PATH, so use full paths.">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={3}
            placeholder="/usr/local/bin/backup.sh >> /var/log/backup.log 2>&1"
            className="w-full rounded-medium border border-field bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/40 placeholder:text-tertiary font-mono"
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="filled" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" disabled={!valid || !command.trim()}>
            {job ? "Done" : "Add job"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CronTool() {
  const sessions = useQuery({
    queryKey: ["sessions-for-cron"],
    queryFn: () => ipc.session.list(),
    // Connections open and close while the tab is up; a closed one can't be saved to.
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const sshSessions = (sessions.data ?? []).filter((s) => s.protocol === "ssh" || s.protocol === "sftp");

  const [targetId, setTargetId] = React.useState<string | null>(null);
  // Default to the first SSH connection, else this Mac.
  React.useEffect(() => {
    if (targetId === null && sessions.data) setTargetId(sshSessions[0]?.sessionId ?? LOCAL);
  }, [sessions.data, sshSessions, targetId]);

  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [lines, setLines] = React.useState<CronLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<CronJob | "new" | null>(null);
  const [confirmSave, setConfirmSave] = React.useState(false);
  const [showFile, setShowFile] = React.useState(false);

  const target: CronTarget | null =
    targetId === null ? null : targetId === LOCAL ? { kind: "local" } : { kind: "session", sessionId: targetId };

  const load = React.useCallback(async (t: CronTarget) => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.tools.cronRead({ target: t });
      setLoaded({ target: t, result });
      setLines(parseCrontab(result.text));
    } catch (err) {
      setLoaded(null);
      setLines([]);
      setError(cleanIpcError(err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (targetId === null) return;
    void load(targetId === LOCAL ? { kind: "local" } : { kind: "session", sessionId: targetId });
  }, [targetId, load]);

  const text = serializeCrontab(lines);
  const dirty = loaded !== null && text !== loaded.result.text;
  const jobs = lines.filter((l): l is CronJob => l.kind === "job");
  const clock = loaded?.result.clock ? parseWallClock(loaded.result.clock) : null;

  async function save() {
    if (!loaded) return;
    setSaving(true);
    try {
      const result = await ipc.tools.cronWrite({ target: loaded.target, text, expected: loaded.result.text });
      setLoaded({ target: loaded.target, result });
      setLines(parseCrontab(result.text));
      toast.success(`Saved the crontab on ${result.where}.`);
    } catch (err) {
      const message = cleanIpcError(err instanceof Error ? err.message : String(err));
      toast.error(message, {
        duration: Infinity,
        action: /changed since/.test(message)
          ? { label: "Reload", onClick: () => void load(loaded.target) }
          : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function switchTarget(next: string) {
    if (dirty && !window.confirm("Discard your unsaved crontab changes?")) return;
    setTargetId(next);
  }

  const where = loaded?.result.where ?? "";
  const targetGone =
    targetId !== null &&
    targetId !== LOCAL &&
    sessions.data !== undefined &&
    !sshSessions.some((s) => s.sessionId === targetId);

  return (
    <ToolLayout
      title="Cron"
      description="Scheduled jobs for your user, on this Mac or a connected server."
      form={
        <>
          <Field label="Machine">
            <Select value={targetId ?? ""} onValueChange={switchTarget}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {sshSessions.map((s) => (
                  <SelectItem key={s.sessionId} value={s.sessionId}>
                    {s.name} ({s.username}@{s.host})
                  </SelectItem>
                ))}
                <SelectItem value={LOCAL}>This Mac</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="transparent"
            iconOnly
            aria-label="Reload crontab"
            disabled={!target || loading}
            onClick={() => {
              if (!target) return;
              if (dirty && !window.confirm("Discard your unsaved crontab changes?")) return;
              void load(target);
            }}
          >
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button variant="filled" disabled={!loaded} onClick={() => setEditing("new")}>
            <PlusIcon className="size-3.5 mr-1" />
            New job
          </Button>
          <Button variant="transparent" disabled={!loaded} onClick={() => setShowFile(true)}>
            <FileTextIcon className="size-3.5 mr-1" />
            View file
          </Button>
        </>
      }
      status={
        targetGone ? (
          <span className="text-support-red">
            That connection has closed. Reconnect, then choose it again
            {dirty ? " (your edits are kept until you switch)" : ""}.
          </span>
        ) : error ? (
          <span className="text-support-red">{error}</span>
        ) : loaded ? (
          <span>
            {loaded.result.user ? `${loaded.result.user} on ` : ""}
            {where}
            {loaded.result.clock ? ` · its clock reads ${loaded.result.clock}` : ""}
            {sshSessions.length === 0 ? " · Connect over SSH to edit a server's crontab." : ""}
          </span>
        ) : undefined
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <EmptyResults>Reading the crontab…</EmptyResults>
          ) : !loaded ? (
            <EmptyResults>{error ? "Couldn't read the crontab." : "Choose a machine."}</EmptyResults>
          ) : jobs.length === 0 ? (
            <EmptyResults>No scheduled jobs on {where}. Add one with New job.</EmptyResults>
          ) : (
            <ResultsTable columns={["On", "When", "Next run", "Command", ""]}>
              {jobs.map((job) => {
                const next = job.enabled && clock ? nextRuns(job.schedule, clock, 1)[0] : undefined;
                return (
                  <tr
                    key={job.id}
                    className={cn("border-b border-separator last:border-b-0 align-top", !job.enabled && "opacity-60")}
                  >
                    <td className="px-5 py-2">
                      <input
                        type="checkbox"
                        checked={job.enabled}
                        onChange={(e) => setLines(updateJob(lines, job.id, { enabled: e.target.checked }))}
                        aria-label={`${job.enabled ? "Switch off" : "Switch on"} ${job.command}`}
                      />
                    </td>
                    <td className="px-5 py-2">
                      <div className="text-primary">{describeSchedule(job.schedule)}</div>
                      <div className="font-mono text-xs text-tertiary">{job.schedule}</div>
                    </td>
                    <td className="px-5 py-2 text-xs text-secondary whitespace-nowrap">
                      {!job.enabled ? "Off" : next && clock ? formatWallClock(next, clock.year) : "—"}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-primary break-all">{job.command}</td>
                    <td className="px-5 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="transparent"
                        size="small"
                        iconOnly
                        aria-label={`Edit ${job.command}`}
                        onClick={() => setEditing(job)}
                      >
                        <PencilIcon className="size-3.5 text-secondary" />
                      </Button>
                      <Button
                        variant="transparent"
                        size="small"
                        iconOnly
                        aria-label={`Delete ${job.command}`}
                        onClick={() => setLines(removeJob(lines, job.id))}
                      >
                        <TrashIcon className="size-3.5 text-secondary" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </ResultsTable>
          )}
        </div>

        {dirty && (
          <div className="flex items-center gap-2 border-t border-separator px-5 py-2 shrink-0" role="status">
            <span className="flex-1 text-xs text-secondary">Unsaved changes to the crontab on {where}.</span>
            <Button
              variant="transparent"
              size="small"
              disabled={saving}
              onClick={() => loaded && setLines(parseCrontab(loaded.result.text))}
            >
              Discard
            </Button>
            <Button variant="accent" size="small" disabled={saving || targetGone} onClick={() => setConfirmSave(true)}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <JobDialog
          job={editing === "new" ? null : editing}
          clock={clock}
          onClose={() => setEditing(null)}
          onSave={(schedule, command) => {
            setLines(
              editing === "new"
                ? addJob(lines, schedule, command)
                : updateJob(lines, editing.id, { schedule, command }),
            );
            setEditing(null);
          }}
        />
      )}

      <AlertDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={`Save the crontab on ${where}?`}
        description="This replaces the whole crontab with the version shown here. Jobs start running on the new schedule straight away."
        confirmLabel="Save"
        onConfirm={() => void save()}
      />

      <Dialog
        open={showFile}
        onOpenChange={setShowFile}
        title={`Crontab on ${where}${dirty ? " (unsaved)" : ""}`}
        size="large"
      >
        <pre
          className="terminal-surface m-4 max-h-[60vh] overflow-auto rounded-medium p-3 font-mono text-xs"
          style={{ color: "#f8f8f2" }}
        >
          {text || "(empty)"}
        </pre>
      </Dialog>
    </ToolLayout>
  );
}
