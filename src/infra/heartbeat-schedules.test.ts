import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { isWithinActiveHours, resolveHeartbeatSchedule } from "./heartbeat-active-hours.js";
import {
  resolveHeartbeatIntervalMs,
  SCHEDULE_RECHECK_INTERVAL_MS,
  startHeartbeatRunner,
} from "./heartbeat-runner.js";

function cfgWithUserTimezone(userTimezone = "UTC"): OpenClawConfig {
  return {
    agents: {
      defaults: {
        userTimezone,
      },
    },
  };
}

describe("resolveHeartbeatSchedule", () => {
  const cfg = cfgWithUserTimezone("UTC");

  it("returns { active: false } when schedules is undefined", () => {
    expect(resolveHeartbeatSchedule(cfg, undefined)).toEqual({ active: false });
    expect(resolveHeartbeatSchedule(cfg, {})).toEqual({ active: false });
  });

  it("returns { active: false } when schedules is empty", () => {
    expect(resolveHeartbeatSchedule(cfg, { schedules: [] })).toEqual({ active: false });
  });

  it("selects the correct schedule block for daytime", () => {
    const heartbeat = {
      schedules: [
        { start: "08:00", end: "18:00", every: "30m" },
        { start: "18:00", end: "23:00", every: "1h" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 10:00 UTC — inside first block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toEqual({
      active: true,
      every: "30m",
    });
    // 20:00 UTC — inside second block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 20, 0, 0))).toEqual({
      active: true,
      every: "1h",
    });
  });

  it("handles overnight wraparound (23:00 → 01:00)", () => {
    const heartbeat = {
      schedules: [
        { start: "08:00", end: "23:00", every: "30m" },
        { start: "23:00", end: "01:00", every: "1h" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 23:30 UTC — inside overnight block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 30, 0))).toEqual({
      active: true,
      every: "1h",
    });
    // 00:30 UTC — still inside overnight block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 2, 0, 30, 0))).toEqual({
      active: true,
      every: "1h",
    });
    // 01:30 UTC — outside all blocks (gap 01:00-08:00)
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 2, 1, 30, 0))).toEqual({
      active: false,
    });
  });

  it("returns { active: false } for gaps not covered by any schedule", () => {
    const heartbeat = {
      schedules: [
        { start: "08:00", end: "12:00", every: "15m" },
        { start: "14:00", end: "18:00", every: "30m" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 13:00 UTC — in the gap
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 13, 0, 0))).toEqual({
      active: false,
    });
    // 20:00 UTC — after all blocks
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 20, 0, 0))).toEqual({
      active: false,
    });
  });

  it("first match wins when schedules overlap", () => {
    const heartbeat = {
      schedules: [
        { start: "08:00", end: "18:00", every: "15m" },
        { start: "10:00", end: "14:00", every: "1h" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 11:00 UTC — overlaps both blocks, first wins
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 11, 0, 0))).toEqual({
      active: true,
      every: "15m",
    });
  });

  it("respects timezone from activeHours", () => {
    const heartbeat = {
      schedules: [{ start: "09:00", end: "17:00", every: "30m" }],
      activeHours: { timezone: "America/New_York" },
    };
    // 15:00 UTC = 10:00 ET — inside
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 15, 0, 0))).toEqual({
      active: true,
      every: "30m",
    });
    // 23:00 UTC = 18:00 ET — outside
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 0, 0))).toEqual({
      active: false,
    });
  });

  it("skips blocks with invalid times", () => {
    const heartbeat = {
      schedules: [
        { start: "bad", end: "12:00", every: "30m" },
        { start: "14:00", end: "18:00", every: "1h" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 10:00 UTC — first block invalid, skip it; not in second block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toEqual({
      active: false,
    });
    // 15:00 UTC — in second block
    expect(resolveHeartbeatSchedule(cfg, heartbeat, Date.UTC(2025, 0, 1, 15, 0, 0))).toEqual({
      active: true,
      every: "1h",
    });
  });
});

describe("isWithinActiveHours with schedules", () => {
  const cfg = cfgWithUserTimezone("UTC");

  it("returns true when inside a schedule block", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "23:00", every: "30m" }],
      activeHours: { timezone: "UTC" },
    };
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 12, 0, 0))).toBe(true);
  });

  it("returns false when outside all schedule blocks", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "23:00", every: "30m" }],
      activeHours: { timezone: "UTC" },
    };
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 3, 0, 0))).toBe(false);
  });

  it("schedules override activeHours", () => {
    const heartbeat = {
      activeHours: { start: "00:00", end: "24:00", timezone: "UTC" },
      schedules: [{ start: "08:00", end: "12:00", every: "30m" }],
    };
    // 15:00 — would be inside activeHours but outside schedules
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 15, 0, 0))).toBe(false);
    // 10:00 — inside schedule block
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toBe(true);
  });

  it("legacy behavior unchanged when no schedules", () => {
    const heartbeat = {
      activeHours: { start: "08:00", end: "22:00", timezone: "UTC" },
    };
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 0, 0))).toBe(false);
  });

  it("empty schedules treated as no schedules (falls back to activeHours)", () => {
    const heartbeat = {
      activeHours: { start: "08:00", end: "22:00", timezone: "UTC" },
      schedules: [],
    };
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 0, 0))).toBe(false);
  });

  it("no schedules and no activeHours returns true", () => {
    expect(isWithinActiveHours(cfg, {}, Date.UTC(2025, 0, 1, 3, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, undefined, Date.UTC(2025, 0, 1, 3, 0, 0))).toBe(true);
  });
});

describe("resolveHeartbeatIntervalMs with schedules", () => {
  const cfg = cfgWithUserTimezone("UTC");

  it("returns the active block's interval when inside a schedule", () => {
    const heartbeat = {
      schedules: [
        { start: "08:00", end: "18:00", every: "30m" },
        { start: "18:00", end: "23:00", every: "1h" },
      ],
      activeHours: { timezone: "UTC" },
    };
    // 10:00 UTC — inside first block → 30 minutes
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0)),
    ).toBe(30 * 60_000);
    // 20:00 UTC — inside second block → 1 hour
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 20, 0, 0)),
    ).toBe(60 * 60_000);
  });

  it("returns null when outside all schedule blocks", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "18:00", every: "30m" }],
      activeHours: { timezone: "UTC" },
    };
    // 03:00 UTC — outside all blocks
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 3, 0, 0)),
    ).toBeNull();
  });

  it("overrideEvery takes precedence over schedules", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "18:00", every: "30m" }],
      activeHours: { timezone: "UTC" },
    };
    // 10:00 UTC — inside schedule block, but overrideEvery wins
    expect(resolveHeartbeatIntervalMs(cfg, "5m", heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0))).toBe(
      5 * 60_000,
    );
  });

  it("falls back to legacy every when no schedules present", () => {
    const heartbeat = { every: "15m" };
    expect(resolveHeartbeatIntervalMs(cfg, undefined, heartbeat)).toBe(15 * 60_000);
  });

  it("returns null for schedule block with invalid duration", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "18:00", every: "nope" }],
      activeHours: { timezone: "UTC" },
    };
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0)),
    ).toBeNull();
  });

  it("returns null for schedule block with zero duration", () => {
    const heartbeat = {
      schedules: [{ start: "08:00", end: "18:00", every: "0m" }],
      activeHours: { timezone: "UTC" },
    };
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 10, 0, 0)),
    ).toBeNull();
  });

  it("handles overnight schedule in resolveHeartbeatIntervalMs", () => {
    const heartbeat = {
      schedules: [{ start: "22:00", end: "06:00", every: "2h" }],
      activeHours: { timezone: "UTC" },
    };
    // 23:00 UTC — inside overnight block
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 23, 0, 0)),
    ).toBe(2 * 60 * 60_000);
    // 12:00 UTC — outside
    expect(
      resolveHeartbeatIntervalMs(cfg, undefined, heartbeat, Date.UTC(2025, 0, 1, 12, 0, 0)),
    ).toBeNull();
  });
});

describe("startHeartbeatRunner with schedule blocks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires heartbeat inside an active schedule block", async () => {
    vi.useFakeTimers();
    // Start at 10:00 UTC — inside the 08:00-18:00 block (every 30m)
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 1, 10, 0, 0)));

    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });

    const runner = startHeartbeatRunner({
      cfg: {
        agents: {
          defaults: {
            userTimezone: "UTC",
            heartbeat: {
              schedules: [
                { start: "08:00", end: "18:00", every: "30m" },
                { start: "18:00", end: "23:00", every: "1h" },
              ],
              activeHours: { timezone: "UTC" },
            },
          },
        },
      } as OpenClawConfig,
      runOnce: runSpy,
    });

    // Advance 30 minutes + buffer — should fire
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1_000);
    expect(runSpy).toHaveBeenCalledTimes(1);

    runner.stop();
  });

  it("uses re-check interval when outside all schedule blocks", async () => {
    vi.useFakeTimers();
    // Start at 03:00 UTC — outside all blocks (gap 23:00-08:00)
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 1, 3, 0, 0)));

    const runSpy = vi.fn().mockResolvedValue({ status: "skipped", reason: "disabled" });

    const runner = startHeartbeatRunner({
      cfg: {
        agents: {
          defaults: {
            userTimezone: "UTC",
            heartbeat: {
              schedules: [{ start: "08:00", end: "18:00", every: "30m" }],
              activeHours: { timezone: "UTC" },
            },
          },
        },
      } as OpenClawConfig,
      runOnce: runSpy,
    });

    // Advance by SCHEDULE_RECHECK_INTERVAL_MS + buffer — should attempt a re-check tick
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECHECK_INTERVAL_MS + 1_000);
    // The runner creates the agent with a 1-minute re-check, so it fires runOnce
    // (which will be skipped via isWithinActiveHours, but the scheduler ticks)
    expect(runSpy).toHaveBeenCalled();

    runner.stop();
  });

  it("transitions between schedule blocks with different intervals", async () => {
    vi.useFakeTimers();
    // Start at 17:30 UTC — inside the 08:00-18:00 block (every 10m)
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 1, 17, 30, 0)));

    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });

    const cfg = {
      agents: {
        defaults: {
          userTimezone: "UTC",
          heartbeat: {
            schedules: [
              { start: "08:00", end: "18:00", every: "10m" },
              { start: "18:00", end: "23:00", every: "1h" },
            ],
            activeHours: { timezone: "UTC" },
          },
        },
      },
    } as OpenClawConfig;

    const runner = startHeartbeatRunner({ cfg, runOnce: runSpy });

    // First tick at 17:40 (10m interval from first block)
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Second tick at 17:50 (still 10m)
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runSpy).toHaveBeenCalledTimes(2);

    // Third tick at 18:00 (still 10m). After this run, advanceAgentSchedule
    // re-resolves and picks up the 1h block since we're now at 18:00.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runSpy).toHaveBeenCalledTimes(3);

    // Now the interval should be 1h. Advancing only 10m should NOT trigger another run.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runSpy).toHaveBeenCalledTimes(3);

    // Advancing the remaining 50m should trigger the next run (1h total from last)
    await vi.advanceTimersByTimeAsync(50 * 60_000 + 1_000);
    expect(runSpy).toHaveBeenCalledTimes(4);

    runner.stop();
  });
});
