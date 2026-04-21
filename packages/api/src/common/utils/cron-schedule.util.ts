import { CronExpressionParser } from 'cron-parser';

// Generic schedule spec parser shared by ScheduledTrigger (node-bound) and
// ScheduledSkillRun (skill-bound). Three accepted formats, in priority order:
//
//   1. `every:Nx`  — interval since last/now. Units: ms, s, m, h, d.
//                    Example: `every:30m`, `every:24h`.
//   2. ISO date    — one-shot. Returns the date if in the future and never run,
//                    otherwise `null` to pause the schedule.
//                    Example: `2026-04-19T09:00:00.000Z`.
//   3. cron        — standard 5- or 6-field cron expression evaluated via
//                    cron-parser, anchored on `lastRunAt ?? now`.
//                    Example: `0 9 * * *` (every day at 09:00).
//
// Unknown / malformed specs fall back to a 1-minute retry to avoid getting
// stuck on a permanently broken row; callers can detect this via tick logs.

export type ScheduleSpec = string;

export function nextScheduledRun(
  spec: ScheduleSpec,
  now: Date,
  lastRunAt?: Date | null,
): Date | null {
  const trimmed = spec.trim();

  if (trimmed.startsWith('every:')) {
    const raw = trimmed.slice('every:'.length).trim();
    const match = raw.match(/^(\d+)(ms|s|m|h|d)$/);
    if (match) {
      const count = Number(match[1] ?? 1);
      const unit = match[2];
      const mult =
        unit === 'ms'
          ? 1
          : unit === 's'
            ? 1_000
            : unit === 'm'
              ? 60_000
              : unit === 'h'
                ? 3_600_000
                : 86_400_000;
      return new Date((lastRunAt ?? now).getTime() + count * mult);
    }
  }

  const once = new Date(trimmed);
  if (!Number.isNaN(once.getTime()) && /^[0-9]/.test(trimmed)) {
    if (lastRunAt) {
      return null;
    }
    if (once.getTime() > now.getTime()) {
      return once;
    }
    return null;
  }

  try {
    const interval = CronExpressionParser.parse(trimmed, {
      currentDate: lastRunAt ?? now,
    });
    return interval.next().toDate();
  } catch {
    return new Date(now.getTime() + 60_000);
  }
}

export function isValidScheduleSpec(spec: string): boolean {
  const trimmed = spec.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('every:')) {
    return /^every:\d+(ms|s|m|h|d)$/.test(trimmed);
  }
  if (/^[0-9]/.test(trimmed) && !Number.isNaN(new Date(trimmed).getTime())) {
    return true;
  }
  try {
    CronExpressionParser.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
