import { describe, expect, it } from "vitest";
import type { Job } from "../../domain/job.js";
import type { SchedulerConfig } from "./scheduler.js";
import { DefaultScheduler } from "./scheduler.js";

// All tests use "America/Toronto" (EST = UTC-5 in January, no DST).
// Dates are constructed from known UTC instants so tests are deterministic
// regardless of the CI machine's local timezone.
//
// EST conversions (January — UTC-5):
//   local 08:00 = UTC 13:00
//   local 09:00 = UTC 14:00
//   local 12:00 = UTC 17:00
//   local 17:00 = UTC 22:00
//   local 18:00 = UTC 23:00

const TZ = "America/Toronto";
const CONFIG: SchedulerConfig = { slots: ["09:00", "17:00"], timeZone: TZ };

function utc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function localHM(date: Date, timeZone: string): { h: number; m: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  return {
    h: Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10),
    m: Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10),
  };
}

function localDay(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, day: "2-digit" });
  const parts = fmt.formatToParts(date);
  return Number.parseInt(parts.find((p) => p.type === "day")?.value ?? "0", 10);
}

function makeJob(id: string, scheduledFor?: string): Job {
  return {
    id,
    question: "q",
    state: "approved",
    ...(scheduledFor !== undefined && { scheduledFor }),
    createdAt: "2024-01-15T00:00:00Z",
    updatedAt: "2024-01-15T00:00:00Z",
  };
}

// ─── nextSlotAfter ─────────────────────────────────────────────────────────

describe("DefaultScheduler.nextSlotAfter", () => {
  const scheduler = new DefaultScheduler();

  it("returns today 09:00 when after is local 08:00", () => {
    const after = utc(2024, 1, 15, 13); // local 08:00 EST
    const result = scheduler.nextSlotAfter(after, CONFIG);
    const { h, m } = localHM(result, TZ);
    expect(h).toBe(9);
    expect(m).toBe(0);
    expect(localDay(result, TZ)).toBe(15); // same day
  });

  it("returns today 17:00 when after is local 12:00", () => {
    const after = utc(2024, 1, 15, 17); // local 12:00 EST
    const result = scheduler.nextSlotAfter(after, CONFIG);
    const { h, m } = localHM(result, TZ);
    expect(h).toBe(17);
    expect(m).toBe(0);
    expect(localDay(result, TZ)).toBe(15);
  });

  it("returns next day 09:00 when after is local 18:00", () => {
    const after = utc(2024, 1, 15, 23); // local 18:00 EST
    const result = scheduler.nextSlotAfter(after, CONFIG);
    const { h, m } = localHM(result, TZ);
    expect(h).toBe(9);
    expect(m).toBe(0);
    expect(localDay(result, TZ)).toBe(16); // next day
  });
});

// ─── assignSlot ────────────────────────────────────────────────────────────

describe("DefaultScheduler.assignSlot", () => {
  const scheduler = new DefaultScheduler();

  it("empty pending + now at local 08:00 → today 09:00", () => {
    const now = utc(2024, 1, 15, 13); // local 08:00
    const result = scheduler.assignSlot([], now, CONFIG);
    const { h } = localHM(result, TZ);
    expect(h).toBe(9);
    expect(localDay(result, TZ)).toBe(15);
  });

  it("pending at today 09:00 → returns today 17:00 (no double-booking)", () => {
    const now = utc(2024, 1, 15, 13); // local 08:00
    const pending = [utc(2024, 1, 15, 14)]; // local 09:00 EST
    const result = scheduler.assignSlot(pending, now, CONFIG);
    const { h } = localHM(result, TZ);
    expect(h).toBe(17);
    expect(localDay(result, TZ)).toBe(15);
  });

  it("pending filling today → rolls to next day first slot", () => {
    const now = utc(2024, 1, 15, 13); // local 08:00
    const pending = [
      utc(2024, 1, 15, 14), // local 09:00
      utc(2024, 1, 15, 22), // local 17:00
    ];
    const result = scheduler.assignSlot(pending, now, CONFIG);
    const { h } = localHM(result, TZ);
    expect(h).toBe(9);
    expect(localDay(result, TZ)).toBe(16);
  });
});

// ─── dueJobs ───────────────────────────────────────────────────────────────

describe("DefaultScheduler.dueJobs", () => {
  const scheduler = new DefaultScheduler();
  // now = 2024-01-15T17:00:00Z (local 12:00 EST)
  const now = utc(2024, 1, 15, 17);

  it("returns only past-scheduled approved jobs", () => {
    const past = makeJob("past", "2024-01-15T16:00:00Z"); // <= now
    const future = makeJob("future", "2024-01-15T18:00:00Z"); // > now
    const noSchedule = makeJob("nosched"); // no scheduledFor
    const result = scheduler.dueJobs([past, future, noSchedule], now);
    expect(result.map((j) => j.id)).toEqual(["past"]);
  });

  it("returns empty array for empty input", () => {
    expect(scheduler.dueJobs([], now)).toEqual([]);
  });

  it("returns due jobs sorted ascending by scheduledFor", () => {
    const early = makeJob("early", "2024-01-15T15:00:00Z");
    const late = makeJob("late", "2024-01-15T16:00:00Z");
    const result = scheduler.dueJobs([late, early], now);
    expect(result.map((j) => j.id)).toEqual(["early", "late"]);
  });
});
