import type { OpenClawConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { resolveUserTimezone } from "../agents/date-time.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

const ACTIVE_HOURS_TIME_PATTERN = /^([01]\d|2[0-3]|24):([0-5]\d)$/;

function resolveActiveHoursTimezone(cfg: OpenClawConfig, raw?: string): string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "user") {
    return resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
  }
  if (trimmed === "local") {
    const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return host?.trim() || "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
  }
}

function parseActiveHoursTime(opts: { allow24: boolean }, raw?: string): number | null {
  if (!raw || !ACTIVE_HOURS_TIME_PATTERN.test(raw)) {
    return null;
  }
  const [hourStr, minuteStr] = raw.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  if (hour === 24) {
    if (!opts.allow24 || minute !== 0) {
      return null;
    }
    return 24 * 60;
  }
  return hour * 60 + minute;
}

function resolveMinutesInTimeZone(nowMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function isTimeInWindow(currentMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) {
    return false;
  }
  if (endMin > startMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Overnight wraparound (e.g. 23:00 → 01:00)
  return currentMin >= startMin || currentMin < endMin;
}

export type HeartbeatScheduleResult = { active: true; every: string } | { active: false };

/**
 * Resolve which schedule block (if any) covers the current time.
 * Returns the matched block's `every` interval, or `{ active: false }` if no block matches.
 * First matching block wins when schedules overlap.
 */
export function resolveHeartbeatSchedule(
  cfg: OpenClawConfig,
  heartbeat?: HeartbeatConfig,
  nowMs?: number,
): HeartbeatScheduleResult {
  const schedules = heartbeat?.schedules;
  if (!schedules || schedules.length === 0) {
    return { active: false };
  }

  const timeZone = resolveActiveHoursTimezone(cfg, heartbeat?.activeHours?.timezone);
  const currentMin = resolveMinutesInTimeZone(nowMs ?? Date.now(), timeZone);
  if (currentMin === null) {
    return { active: false };
  }

  for (const block of schedules) {
    const startMin = parseActiveHoursTime({ allow24: false }, block.start);
    const endMin = parseActiveHoursTime({ allow24: true }, block.end);
    if (startMin === null || endMin === null) {
      continue;
    }
    if (isTimeInWindow(currentMin, startMin, endMin)) {
      return { active: true, every: block.every };
    }
  }

  return { active: false };
}

export function isWithinActiveHours(
  cfg: OpenClawConfig,
  heartbeat?: HeartbeatConfig,
  nowMs?: number,
): boolean {
  // When schedules are present, they override activeHours
  const schedules = heartbeat?.schedules;
  if (schedules && schedules.length > 0) {
    const result = resolveHeartbeatSchedule(cfg, heartbeat, nowMs);
    return result.active;
  }

  const active = heartbeat?.activeHours;
  if (!active) {
    return true;
  }

  const startMin = parseActiveHoursTime({ allow24: false }, active.start);
  const endMin = parseActiveHoursTime({ allow24: true }, active.end);
  if (startMin === null || endMin === null) {
    return true;
  }
  if (startMin === endMin) {
    return true;
  }

  const timeZone = resolveActiveHoursTimezone(cfg, active.timezone);
  const currentMin = resolveMinutesInTimeZone(nowMs ?? Date.now(), timeZone);
  if (currentMin === null) {
    return true;
  }

  if (endMin > startMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  return currentMin >= startMin || currentMin < endMin;
}
