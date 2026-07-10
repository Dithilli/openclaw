import { describe, expect, it } from "vitest";
import {
  healthExportEnvelopeSchema,
  metricPointKey,
  normalizeMetricPoints,
  normalizeWorkout,
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
