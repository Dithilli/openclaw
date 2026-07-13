import { describe, expect, it } from "vitest";
import {
  healthExportEnvelopeSchema,
  isSleepMetricName,
  metricPointKey,
  normalizeMetricPoints,
  normalizeSleepPoints,
  normalizeWorkout,
  sleepDayKey,
} from "./schema.js";

describe("normalizeWorkout", () => {
  it("keys by id and coerces qty-object numeric fields", () => {
    const workout = normalizeWorkout({
      id: "abc",
      name: "Traditional Strength Training",
      start: "2026-07-09 07:00:00 -0500",
      end: "2026-07-09 07:45:00 -0500",
      duration: 2700,
      activeEnergyBurned: { qty: 350, units: "kcal" },
      distance: 0,
    });
    expect(workout).toEqual({
      id: "abc",
      name: "Traditional Strength Training",
      start: "2026-07-09 07:00:00 -0500",
      end: "2026-07-09 07:45:00 -0500",
      durationSec: 2700,
      activeEnergy: 350,
      distance: 0,
    });
  });

  it("derives a key from name:start when id is missing", () => {
    const workout = normalizeWorkout({ name: "Run", start: "2026-07-08 06:00:00 -0500" });
    expect(workout?.id).toBe("Run:2026-07-08 06:00:00 -0500");
  });

  it("returns null when no stable key can be derived", () => {
    expect(normalizeWorkout({ name: "Run" })).toBeNull();
  });
});

describe("normalizeMetricPoints", () => {
  it("flattens samples and skips incomplete ones", () => {
    const points = normalizeMetricPoints({
      name: "heart_rate",
      units: "count/min",
      data: [
        { date: "2026-07-09 00:00:00 -0500", qty: 62 },
        { date: "2026-07-10 00:00:00 -0500" },
        { qty: 5 },
      ],
    });
    expect(points).toEqual([
      { name: "heart_rate", date: "2026-07-09 00:00:00 -0500", qty: 62, units: "count/min" },
    ]);
  });

  it("builds a stable name:date key", () => {
    expect(metricPointKey("heart_rate", "2026-07-09")).toBe("heart_rate:2026-07-09");
  });
});

describe("healthExportEnvelopeSchema", () => {
  it("accepts a permissive HAE envelope with unknown keys", () => {
    const result = healthExportEnvelopeSchema.safeParse({
      data: { workouts: [{ id: "a" }], metrics: [{ name: "m", data: [] }], extra: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing data", () => {
    expect(healthExportEnvelopeSchema.safeParse({}).success).toBe(false);
  });
});

describe("sleep helpers", () => {
  it("identifies the sleep metric name exactly (not substrings)", () => {
    expect(isSleepMetricName("sleep_analysis")).toBe(true);
    expect(isSleepMetricName("sleepAnalysis")).toBe(true);
    expect(isSleepMetricName("apple_sleeping_wrist_temperature")).toBe(false);
    expect(isSleepMetricName("heart_rate")).toBe(false);
    expect(isSleepMetricName(undefined)).toBe(false);
  });

  it("normalizes aggregated sleep points, keeping present fields", () => {
    const nights = normalizeSleepPoints([
      {
        date: "2026-07-12 06:30:00 -0700",
        totalSleep: 7.2,
        deep: 1.1,
        rem: 1.8,
        core: 4.3,
        awake: 0.4,
        inBed: 7.9,
        sleepStart: "2026-07-11 22:45:00 -0700",
        sleepEnd: "2026-07-12 06:30:00 -0700",
      },
    ]);
    expect(nights).toEqual([
      {
        date: "2026-07-12 06:30:00 -0700",
        totalSleepHr: 7.2,
        deepHr: 1.1,
        remHr: 1.8,
        coreHr: 4.3,
        awakeHr: 0.4,
        inBedHr: 7.9,
        start: "2026-07-11 22:45:00 -0700",
        end: "2026-07-12 06:30:00 -0700",
      },
    ]);
  });

  it("falls back to asleep/qty for total and skips point with no date", () => {
    expect(normalizeSleepPoints([{ asleep: 6.5 }])).toEqual([]);
    expect(normalizeSleepPoints([{ date: "2026-07-11", qty: 6.5 }])).toEqual([
      { date: "2026-07-11", totalSleepHr: 6.5 },
    ]);
  });

  it("derives per-night day key", () => {
    expect(sleepDayKey("2026-07-12 06:30:00 -0700")).toBe("2026-07-12");
  });
});
