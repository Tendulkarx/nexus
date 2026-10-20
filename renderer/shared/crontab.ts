/**
 * Crontab files without any I/O: parse a user crontab into lines Nexus can
 * edit, write it back, describe schedules in words and work out the next run
 * times. Shared by the Cron tool (renderer) and its tests.
 *
 * Round-tripping is the priority: every line that isn't a job (comments,
 * blank lines, MAILTO=…, anything unrecognised) is kept byte for byte, and a
 * job line is only rewritten when it's edited. A job is switched off the way
 * people do it by hand, by commenting it out ("# 0 5 * * * backup.sh"); a
 * comment only counts as a switched-off job when its schedule fields are
 * valid cron, so ordinary prose comments stay comments.
 */

export type CronLine =
  | { kind: "other"; text: string }
  | { kind: "job"; id: number; enabled: boolean; schedule: string; command: string; text: string };

export type CronJob = Extract<CronLine, { kind: "job" }>;

/** @-shortcuts and what they stand for. */
const SHORTCUTS: Record<string, string | null> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@reboot": null,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface FieldSpec {
  min: number;
  max: number;
  names?: string[];
  /** Value the names start at (months are 1-based, days 0-based). */
  nameBase?: number;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS, nameBase: 1 },
  // 7 is Sunday too.
  { min: 0, max: 7, names: DAYS, nameBase: 0 },
];

function parseValue(token: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    return n >= spec.min && n <= spec.max ? n : null;
  }
  const i = spec.names?.indexOf(token.toLowerCase()) ?? -1;
  return i >= 0 ? i + (spec.nameBase ?? 0) : null;
}

/** The values a field allows, or null if it isn't valid cron. */
export function expandField(field: string, spec: FieldSpec): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = spec.min;
      hi = spec.max;
    } else {
      const [a, b] = m[1].split("-");
      const from = parseValue(a, spec);
      const to = b === undefined ? (m[2] ? spec.max : from) : parseValue(b, spec);
      if (from === null || to === null || to < from) return null;
      lo = from;
      hi = to;
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** A schedule's five fields (an @-shortcut expanded), or null for @reboot or anything invalid. */
function scheduleFields(schedule: string): string[] | null {
  const s = schedule.trim();
  if (s.startsWith("@")) {
    const expanded = SHORTCUTS[s.toLowerCase()];
    return expanded ? expanded.split(" ") : null;
  }
  const fields = s.split(/\s+/);
  return fields.length === 5 ? fields : null;
}

/** True for a schedule cron accepts: five valid fields or an @-shortcut. */
export function isValidSchedule(schedule: string): boolean {
  const s = schedule.trim();
  if (s.toLowerCase() in SHORTCUTS) return true;
  const fields = scheduleFields(s);
  return fields !== null && fields.every((f, i) => expandField(f, FIELDS[i]) !== null);
}

/** Splits "<schedule> <command>" into its parts, or null if it doesn't start with a valid schedule. */
function splitJob(body: string): { schedule: string; command: string } | null {
  const shortcut = /^(@[a-z]+)\s+(\S.*)$/i.exec(body);
  if (shortcut) {
    return shortcut[1].toLowerCase() in SHORTCUTS ? { schedule: shortcut[1], command: shortcut[2] } : null;
  }
  const m = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S.*)$/.exec(body);
  if (!m || !isValidSchedule(m[1])) return null;
  return { schedule: m[1].replace(/\s+/g, " "), command: m[2] };
}

const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;

export function parseCrontab(text: string): CronLine[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (text === "") return [];
  let id = 0;
  return lines.map((line): CronLine => {
    const trimmed = line.trim();
    if (!trimmed || ENV_LINE.test(trimmed)) return { kind: "other", text: line };
    const disabled = /^#\s*(.*)$/.exec(trimmed);
    const job = splitJob(disabled ? disabled[1] : trimmed);
    if (!job) return { kind: "other", text: line };
    return { kind: "job", id: id++, enabled: !disabled, schedule: job.schedule, command: job.command, text: line };
  });
}

/** The line a job writes back as: its original text if untouched, else rebuilt. */
export function jobLine(job: Pick<CronJob, "enabled" | "schedule" | "command">): string {
  return `${job.enabled ? "" : "# "}${job.schedule.trim().replace(/\s+/g, " ")} ${job.command.trim()}`;
}

export function serializeCrontab(lines: CronLine[]): string {
  if (lines.length === 0) return "";
  // crontab requires a final newline, or the last job is ignored.
  return lines.map((l) => l.text).join("\n") + "\n";
}

/** Replaces a job (by id), keeping its line's position. */
export function updateJob(
  lines: CronLine[],
  id: number,
  patch: Partial<Pick<CronJob, "enabled" | "schedule" | "command">>,
): CronLine[] {
  return lines.map((l) => {
    if (l.kind !== "job" || l.id !== id) return l;
    const next = { ...l, ...patch };
    return { ...next, text: jobLine(next) };
  });
}

export function removeJob(lines: CronLine[], id: number): CronLine[] {
  return lines.filter((l) => l.kind !== "job" || l.id !== id);
}

export function addJob(lines: CronLine[], schedule: string, command: string): CronLine[] {
  const id = Math.max(-1, ...lines.map((l) => (l.kind === "job" ? l.id : -1))) + 1;
  const job = { enabled: true, schedule, command };
  return [...lines, { kind: "job", id, ...job, text: jobLine(job) }];
}

// ── Words ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** "Every day at 05:00", "Every 15 minutes", "At 02:30 on Monday and Friday"; the raw schedule when it's unusual. */
export function describeSchedule(schedule: string): string {
  const s = schedule.trim().toLowerCase();
  if (s === "@reboot") return "When the machine starts";
  const fields = scheduleFields(s);
  if (!fields || !isValidSchedule(s)) return "Not a valid schedule";
  const [min, hour, dom, mon, dow] = fields;
  const sets = fields.map((f, i) => expandField(f, FIELDS[i])!);
  const days = [...sets[4]].map((d) => d % 7);
  const allDays = dow === "*";

  // When it runs within the day.
  let time: string;
  const stepMin = /^\*\/(\d+)$/.exec(min);
  if (min === "*" && hour === "*") time = "Every minute";
  else if (stepMin && hour === "*") time = `Every ${stepMin[1]} minutes`;
  else if (/^\d+$/.test(min) && hour === "*")
    time = min === "0" ? "Every hour" : `Every hour at ${pad(Number(min))} past`;
  else if (/^\d+$/.test(min) && /^\*\/\d+$/.test(hour))
    time = `Every ${hour.slice(2)} hours at ${pad(Number(min))} past`;
  else if (/^\d+$/.test(min) && sets[1].size <= 6) {
    time = `At ${list([...sets[1]].map((h) => `${pad(h)}:${pad(Number(min))}`))}`;
  } else return schedule.trim();

  const parts = [time];
  if (dom !== "*") parts.push(`on the ${list([...sets[2]].map(ordinal))}`);
  if (mon !== "*") parts.push(`in ${list([...sets[3]].map((m) => MONTH_NAMES[m - 1]))}`);
  if (!allDays) {
    const unique = [...new Set(days)].sort();
    const weekdays = unique.join() === "1,2,3,4,5";
    const text = weekdays ? "on weekdays" : `on ${list(unique.map((d) => DAY_NAMES[d]))}`;
    parts.push(dom !== "*" ? `or ${text}` : text);
  }
  let out = parts.join(" ");
  // "At 05:00" alone means every day.
  if (dom === "*" && mon === "*" && allDays && out.startsWith("At ")) out = `Every day at ${out.slice(3)}`;
  return out;
}

// ── Next runs ─────────────────────────────────────────────────────────────

/** A wall-clock time on the machine that runs the crontab. Plain fields, so no time zone gets applied. */
export interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The next `count` times the schedule fires strictly after `from`, in the
 * crontab machine's own wall-clock time. Follows cron's rule that when both
 * day-of-month and day-of-week are restricted, either one matching is enough.
 * Searches up to eight years ahead (for 29 February), then gives up.
 */
export function nextRuns(schedule: string, from: WallClock, count = 3): WallClock[] {
  const fields = scheduleFields(schedule);
  if (!fields || !isValidSchedule(schedule)) return [];
  const [mins, hours, doms, mons, dowsRaw] = fields.map((f, i) => expandField(f, FIELDS[i])!);
  const dows = new Set([...dowsRaw].map((d) => d % 7));
  const domRestricted = fields[2] !== "*";
  const dowRestricted = fields[4] !== "*";
  const dayMatches = (y: number, m: number, d: number) => {
    const domOk = doms.has(d);
    const dowOk = dows.has(weekday(y, m, d));
    if (domRestricted && dowRestricted) return domOk || dowOk;
    return domOk && dowOk;
  };

  const out: WallClock[] = [];
  const sortedHours = [...hours].sort((a, b) => a - b);
  const sortedMins = [...mins].sort((a, b) => a - b);
  for (let y = from.year; y <= from.year + 8 && out.length < count; y++) {
    for (let m = y === from.year ? from.month : 1; m <= 12 && out.length < count; m++) {
      if (!mons.has(m)) continue;
      const firstDay = y === from.year && m === from.month ? from.day : 1;
      for (let d = firstDay; d <= daysInMonth(y, m) && out.length < count; d++) {
        if (!dayMatches(y, m, d)) continue;
        const today = y === from.year && m === from.month && d === from.day;
        for (const h of sortedHours) {
          if (today && h < from.hour) continue;
          for (const min of sortedMins) {
            if (today && h === from.hour && min <= from.minute) continue;
            out.push({ year: y, month: m, day: d, hour: h, minute: min });
            if (out.length === count) return out;
          }
        }
      }
    }
  }
  return out;
}

/** "Tue 21 Oct, 05:00", with the year only when it isn't `nowYear`. */
export function formatWallClock(t: WallClock, nowYear: number): string {
  const dayName = DAY_NAMES[weekday(t.year, t.month, t.day)].slice(0, 3);
  const year = t.year === nowYear ? "" : ` ${t.year}`;
  return `${dayName} ${t.day} ${MONTH_NAMES[t.month - 1].slice(0, 3)}${year}, ${pad(t.hour)}:${pad(t.minute)}`;
}

/** Parses `date '+%Y-%m-%d %H:%M'` output. */
export function parseWallClock(text: string): WallClock | null {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  return { year, month, day, hour, minute };
}
