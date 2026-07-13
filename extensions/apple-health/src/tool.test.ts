import { describe, expect, it } from "vitest";
import type { HealthStore } from "./store.js";
import { createHealthQueryTool } from "./tool.js";

const fakeStore = {
  async listWorkouts() {
    return [
      { id: "w1", name: "Run", start: "2026-07-01" },
      { id: "w2", name: "Lift", start: "2026-07-05" },
    ];
  },
  async summarize() {
    return { count: 2, totalDurationSec: 100, totalActiveEnergy: 50, byType: [] };
  },
  async listMetric(name: string) {
    return [{ name, date: "2026-07-05", qty: 64 }];
  },
  async listSleep() {
    return [{ date: "2026-07-12", totalSleepHr: 7.2, deepHr: 1.1, remHr: 1.8 }];
  },
} as unknown as HealthStore;

describe("createHealthQueryTool", () => {
  it("returns workouts for list_workouts", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "list_workouts" });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.details).toEqual({
      workouts: [
        { id: "w1", name: "Run", start: "2026-07-01" },
        { id: "w2", name: "Lift", start: "2026-07-05" },
      ],
    });
  });

  it("reverses order for latest", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "latest" });
    expect((result.details as { workouts: { id: string }[] }).workouts.map((w) => w.id)).toEqual([
      "w2",
      "w1",
    ]);
  });

  it("requires metricName for the metric action", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "metric" });
    expect(result.details).toEqual({ error: "metricName_required" });
  });

  it("returns metric points when metricName is provided", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "metric", metricName: "heart_rate" });
    expect(result.details).toEqual({
      metric: "heart_rate",
      points: [{ name: "heart_rate", date: "2026-07-05", qty: 64 }],
    });
  });

  it("returns the aggregate for summarize", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "summarize" });
    expect(result.details).toMatchObject({ count: 2, totalDurationSec: 100 });
  });

  it("returns nightly records for sleep", async () => {
    const tool = createHealthQueryTool(fakeStore);
    const result = await tool.execute("id", { action: "sleep" });
    expect(result.details).toEqual({
      sleep: [{ date: "2026-07-12", totalSleepHr: 7.2, deepHr: 1.1, remHr: 1.8 }],
    });
  });
});
