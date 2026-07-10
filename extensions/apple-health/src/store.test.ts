import { describe, expect, it } from "vitest";
import type { PluginRuntime } from "../api.js";
import { createHealthStore } from "./store.js";

// Minimal in-memory stand-in for api.runtime.state used to exercise the store.
function fakeState(): PluginRuntime["state"] {
  const namespaces = new Map<
    string,
    Map<string, { key: string; value: unknown; createdAt: number }>
  >();
  const openKeyedStore = (options: { namespace: string }) => {
    let entries = namespaces.get(options.namespace);
    if (!entries) {
      entries = new Map();
      namespaces.set(options.namespace, entries);
    }
    const store = entries;
    return {
      async register(key: string, value: unknown) {
        store.set(key, { key, value, createdAt: 0 });
      },
      async registerIfAbsent(key: string, value: unknown) {
        if (store.has(key)) {
          return false;
        }
        store.set(key, { key, value, createdAt: 0 });
        return true;
      },
      async lookup(key: string) {
        return store.get(key)?.value;
      },
      async consume(key: string) {
        const entry = store.get(key);
        store.delete(key);
        return entry?.value;
      },
      async delete(key: string) {
        return store.delete(key);
      },
      async entries() {
        return [...store.values()];
      },
      async clear() {
        store.clear();
      },
    };
  };
  return { openKeyedStore } as unknown as PluginRuntime["state"];
}

const envelope = {
  data: {
    workouts: [
      {
        id: "w1",
        name: "Run",
        start: "2026-07-01 06:00:00 -0500",
        duration: 1800,
        activeEnergyBurned: { qty: 200 },
      },
      {
        id: "w2",
        name: "Traditional Strength Training",
        start: "2026-07-05 07:00:00 -0500",
        duration: 2700,
        activeEnergyBurned: { qty: 350 },
      },
    ],
    metrics: [
      {
        name: "heart_rate",
        units: "count/min",
        data: [
          { date: "2026-07-01 00:00:00 -0500", qty: 60 },
          { date: "2026-07-05 00:00:00 -0500", qty: 64 },
        ],
      },
    ],
  },
};

describe("createHealthStore", () => {
  it("ingests and dedupes workouts by id", async () => {
    const store = createHealthStore(fakeState());
    expect(await store.ingest(envelope)).toEqual({ workouts: 2, metrics: 2 });
    await store.ingest(envelope); // re-send should not duplicate
    expect(await store.listWorkouts({})).toHaveLength(2);
  });

  it("filters workouts by date range and type", async () => {
    const store = createHealthStore(fakeState());
    await store.ingest(envelope);
    expect((await store.listWorkouts({ since: "2026-07-03" })).map((w) => w.id)).toEqual(["w2"]);
    expect((await store.listWorkouts({ workoutType: "strength" })).map((w) => w.id)).toEqual([
      "w2",
    ]);
  });

  it("summarizes totals and buckets by type", async () => {
    const store = createHealthStore(fakeState());
    await store.ingest(envelope);
    const summary = await store.summarize({});
    expect(summary.count).toBe(2);
    expect(summary.totalDurationSec).toBe(4500);
    expect(summary.totalActiveEnergy).toBe(550);
    expect(summary.byType.map((b) => b.name).toSorted()).toEqual([
      "Run",
      "Traditional Strength Training",
    ]);
  });

  it("lists metric samples case-insensitively within a range", async () => {
    const store = createHealthStore(fakeState());
    await store.ingest(envelope);
    expect(await store.listMetric("HEART_RATE", { since: "2026-07-03" })).toEqual([
      { name: "heart_rate", date: "2026-07-05 00:00:00 -0500", qty: 64, units: "count/min" },
    ]);
  });
});
