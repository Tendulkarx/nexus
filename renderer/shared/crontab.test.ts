import { describe, it, expect } from "vitest";

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
} from "./crontab.js";

const SAMPLE = [
  "# m h  dom mon dow   command",
  "MAILTO=ops@example.com",
  "",
  "0 5 * * * /usr/local/bin/backup.sh >/dev/null 2>&1",
  "#*/15  *  * * *  curl -fsS https://hc.example/ping",
  "# Run the report on weekdays",
  "@reboot /home/me/start.sh",
  "this line is broken",
].join("\n");

const jobs = (text: string) => parseCrontab(text).filter((l): l is CronJob => l.kind === "job");

describe("parseCrontab / serializeCrontab", () => {
  it("finds jobs, including commented-out ones, and leaves everything else alone", () => {
    expect(jobs(SAMPLE).map((j) => [j.enabled, j.schedule, j.command])).toEqual([
      [true, "0 5 * * *", "/usr/local/bin/backup.sh >/dev/null 2>&1"],
      [false, "*/15 * * * *", "curl -fsS https://hc.example/ping"],
      [true, "@reboot", "/home/me/start.sh"],
    ]);
  });

  it("round-trips a file it didn't change byte for byte (plus the final newline)", () => {
    expect(serializeCrontab(parseCrontab(SAMPLE))).toBe(`${SAMPLE}\n`);
    expect(serializeCrontab(parseCrontab(""))).toBe("");
  });

  it("doesn't mistake prose comments for switched-off jobs", () => {
    expect(jobs("# Run this every day at 5 please")).toEqual([]);
    expect(jobs("# m h  dom mon dow   command")).toEqual([]);
  });

  it("rewrites only the edited line, in place", () => {
    const lines = parseCrontab(SAMPLE);
    const [backup, ping] = jobs(SAMPLE);
    const next = updateJob(updateJob(lines, ping.id, { enabled: true }), backup.id, { schedule: "30  4 * * 1-5" });
    const out = serializeCrontab(next).split("\n");
    expect(out[3]).toBe("30 4 * * 1-5 /usr/local/bin/backup.sh >/dev/null 2>&1");
    expect(out[4]).toBe("*/15 * * * * curl -fsS https://hc.example/ping");
    expect(out[0]).toBe("# m h  dom mon dow   command");
  });

  it("switches a job off by commenting it out, and adds and removes jobs", () => {
    const lines = parseCrontab("0 5 * * * a.sh\n");
    const [job] = jobs("0 5 * * * a.sh");
    expect(serializeCrontab(updateJob(lines, job.id, { enabled: false }))).toBe("# 0 5 * * * a.sh\n");
    const added = addJob(lines, "@hourly", "b.sh");
    expect(serializeCrontab(added)).toBe("0 5 * * * a.sh\n@hourly b.sh\n");
    expect(serializeCrontab(removeJob(added, job.id))).toBe("@hourly b.sh\n");
  });
});

describe("isValidSchedule", () => {
  it("accepts cron syntax and shortcuts, rejects the rest", () => {
    for (const ok of ["* * * * *", "*/5 0-6,22 1 jan-mar mon-fri", "0 0 * * 7", "@daily", "15 3 * * SUN"]) {
      expect(isValidSchedule(ok), ok).toBe(true);
    }
    for (const bad of ["60 * * * *", "* * * *", "* 24 * * *", "@sometimes", "5-1 * * * *", "*/0 * * * *"]) {
      expect(isValidSchedule(bad), bad).toBe(false);
    }
  });
});

describe("describeSchedule", () => {
  it("says common schedules in words", () => {
    expect(describeSchedule("0 5 * * *")).toBe("Every day at 05:00");
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("0 * * * *")).toBe("Every hour");
    expect(describeSchedule("30 2 * * 1,5")).toBe("At 02:30 on Monday and Friday");
    expect(describeSchedule("0 9 * * 1-5")).toBe("At 09:00 on weekdays");
    expect(describeSchedule("0 0 1 * *")).toBe("At 00:00 on the 1st");
    expect(describeSchedule("@reboot")).toBe("When the machine starts");
    expect(describeSchedule("@weekly")).toBe("At 00:00 on Sunday");
  });

  it("falls back to the schedule itself when words would be clumsy", () => {
    expect(describeSchedule("1,7,13,19,25,31,37 * * * *")).toBe("1,7,13,19,25,31,37 * * * *");
  });
});

describe("nextRuns", () => {
  const now = { year: 2026, month: 10, day: 20, hour: 17, minute: 30 }; // a Tuesday

  it("finds the next runs after now, in order", () => {
    expect(nextRuns("0 5 * * *", now).map((t) => formatWallClock(t, 2026))).toEqual([
      "Wed 21 Oct, 05:00",
      "Thu 22 Oct, 05:00",
      "Fri 23 Oct, 05:00",
    ]);
    expect(nextRuns("*/15 * * * *", now, 2).map((t) => `${t.hour}:${t.minute}`)).toEqual(["17:45", "18:0"]);
  });

  it("treats day-of-month and day-of-week as either-or when both are set", () => {
    // The 1st, or any Friday.
    const runs = nextRuns("0 0 1 * 5", now, 3).map((t) => formatWallClock(t, 2026));
    expect(runs).toEqual(["Fri 23 Oct, 00:00", "Fri 30 Oct, 00:00", "Sun 1 Nov, 00:00"]);
  });

  it("finds a leap day years ahead, and nothing for @reboot", () => {
    expect(nextRuns("0 0 29 2 *", now, 1)).toEqual([{ year: 2028, month: 2, day: 29, hour: 0, minute: 0 }]);
    expect(nextRuns("@reboot", now)).toEqual([]);
  });

  it("reads the machine's clock from date output", () => {
    expect(parseWallClock("2026-10-20 17:30 +0100\n")).toEqual(now);
  });
});
