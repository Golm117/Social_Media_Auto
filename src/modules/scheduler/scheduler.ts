import type { Job } from "../../domain/job.js";

export interface SchedulerConfig {
  slots: string[]; // daily publish times, 24h "HH:MM", e.g. ["09:00","17:00"]
  timeZone: string; // IANA tz, e.g. "America/Toronto"
}

export interface Scheduler {
  // Next slot datetime STRICTLY after `after`, computed in config.timeZone.
  nextSlotAfter(after: Date, config: SchedulerConfig): Date;
  // Assign a publish time for a newly-approved job: the next slot after the latest
  // already-scheduled pending time (or after `now` if none).
  assignSlot(pendingScheduledFor: Date[], now: Date, config: SchedulerConfig): Date;
  // Of the given approved jobs, which are due now (scheduledFor present AND <= now)?
  dueJobs(approvedJobs: Job[], now: Date): Job[];
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getLocalParts(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part !== undefined ? Number.parseInt(part.value, 10) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// Convert a local date/time in the given IANA timezone to a UTC Date.
// Uses probe-and-correct: treats the local time naively as UTC, measures
// the resulting offset, and subtracts it. Correct for all standard offsets;
// may pick the pre-DST instant for the ambiguous "fall back" hour.
function localToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const local = getLocalParts(naive, timeZone);
  const naiveLocalMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const wantedMs = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(naive.getTime() - (naiveLocalMs - wantedMs));
}

function parseSlot(slot: string): [number, number] {
  const colonIdx = slot.indexOf(":");
  if (colonIdx === -1) throw new Error(`Invalid slot format: ${slot}`);
  return [
    Number.parseInt(slot.slice(0, colonIdx), 10),
    Number.parseInt(slot.slice(colonIdx + 1), 10),
  ];
}

export class DefaultScheduler implements Scheduler {
  nextSlotAfter(after: Date, config: SchedulerConfig): Date {
    const localAfter = getLocalParts(after, config.timeZone);
    const sorted = [...config.slots].sort();

    for (const slot of sorted) {
      const [slotH, slotM] = parseSlot(slot);
      const candidate = localToUTC(
        localAfter.year,
        localAfter.month,
        localAfter.day,
        slotH,
        slotM,
        config.timeZone,
      );
      if (candidate > after) return candidate;
    }

    // All today's slots are ≤ after — advance to tomorrow's first slot.
    // Noon avoids DST edge cases that occur around midnight.
    const noonToday = localToUTC(
      localAfter.year,
      localAfter.month,
      localAfter.day,
      12,
      0,
      config.timeZone,
    );
    const noonTomorrow = new Date(noonToday.getTime() + 24 * 60 * 60_000);
    const localTomorrow = getLocalParts(noonTomorrow, config.timeZone);

    const firstSlot = sorted[0];
    if (firstSlot === undefined) throw new Error("SchedulerConfig.slots must not be empty");
    const [firstH, firstM] = parseSlot(firstSlot);
    return localToUTC(
      localTomorrow.year,
      localTomorrow.month,
      localTomorrow.day,
      firstH,
      firstM,
      config.timeZone,
    );
  }

  assignSlot(pendingScheduledFor: Date[], now: Date, config: SchedulerConfig): Date {
    // base = max(now, latest pending) so approved jobs queue into successive slots.
    let base = now;
    for (const d of pendingScheduledFor) {
      if (d > base) base = d;
    }
    return this.nextSlotAfter(base, config);
  }

  // Post-now override: the runtime sets a job's scheduledFor to now (or past),
  // and dueJobs will include it immediately without any special logic here.
  dueJobs(approvedJobs: Job[], now: Date): Job[] {
    return approvedJobs
      .filter(
        (j): j is Job & { scheduledFor: string } =>
          j.scheduledFor !== undefined && new Date(j.scheduledFor) <= now,
      )
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  }
}
