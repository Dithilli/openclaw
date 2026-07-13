// Apple Health helper module persists and queries health data via plugin KV.
import type { PluginRuntime } from "../api.js";
import {
  isSleepMetricName,
  metricPointKey,
  normalizeMetricPoints,
  normalizeSleepPoints,
  normalizeWorkout,
  sleepDayKey,
  type HealthExportEnvelope,
  type StoredMetricPoint,
  type StoredSleep,
  type StoredWorkout,
} from "./schema.js";

const WORKOUTS_NAMESPACE = "workouts";
const METRICS_NAMESPACE = "metrics";
const SLEEP_NAMESPACE = "sleep";
// These MUST sum below the plugin-wide fuse MAX_PLUGIN_STATE_ENTRIES_PER_PLUGIN
// (50_000 across all of this plugin's namespaces). If the combined live rows
// exceed that fuse, the store sheds oldest rows from whichever namespace is
// being written - so an over-cap namespace would evict another's history on the
// next write. Keeping the sum under the fuse lets each namespace self-prune its
// own oldest (a clean rolling window). Larger retention is the documented signal
// to move to a dedicated SQLite schema. Sum: 15k + 25k + 5k = 45k.
const MAX_WORKOUTS = 15_000;
const MAX_METRICS = 25_000;
const MAX_SLEEP = 5_000;

export type WorkoutFilter = {
  since?: string;
  until?: string;
  workoutType?: string;
};

export type WorkoutSummary = {
  count: number;
  totalDurationSec: number;
  totalActiveEnergy: number;
  byType: { name: string; count: number; durationSec: number; activeEnergy: number }[];
};

/** Compare on the YYYY-MM-DD prefix so mixed HAE date formats sort safely. */
function dateKey(value: string | undefined): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

function inRange(value: string | undefined, since?: string, until?: string): boolean {
  const day = dateKey(value);
  if (!day) {
    return since === undefined && until === undefined;
  }
  const lower = dateKey(since);
  const upper = dateKey(until);
  if (lower && day < lower) {
    return false;
  }
  if (upper && day > upper) {
    return false;
  }
  return true;
}

export function createHealthStore(state: PluginRuntime["state"]) {
  const workouts = state.openKeyedStore<StoredWorkout>({
    namespace: WORKOUTS_NAMESPACE,
    maxEntries: MAX_WORKOUTS,
  });
  const metrics = state.openKeyedStore<StoredMetricPoint>({
    namespace: METRICS_NAMESPACE,
    maxEntries: MAX_METRICS,
  });
  const sleep = state.openKeyedStore<StoredSleep>({
    namespace: SLEEP_NAMESPACE,
    maxEntries: MAX_SLEEP,
  });

  async function readWorkouts(filter: WorkoutFilter): Promise<StoredWorkout[]> {
    const entries = await workouts.entries();
    const type = filter.workoutType?.toLowerCase();
    const rows = entries
      .map((entry) => entry.value)
      .filter((workout) => inRange(workout.start, filter.since, filter.until))
      .filter((workout) => !type || (workout.name ?? "").toLowerCase().includes(type));
    // Ascending by start so callers can slice deterministically.
    return rows.toSorted((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  }

  return {
    /**
     * Upsert workouts (by id), metric samples (by name:date), and sleep nights
     * (by day). Sleep arrives as a metric named "sleep_analysis" or a top-level
     * `sleepAnalysis` array; both route to the sleep namespace. Re-sends dedupe.
     */
    async ingest(
      envelope: HealthExportEnvelope,
    ): Promise<{ workouts: number; metrics: number; sleep: number }> {
      let workoutCount = 0;
      for (const raw of envelope.data.workouts ?? []) {
        const normalized = normalizeWorkout(raw as Record<string, unknown>);
        if (!normalized) {
          continue;
        }
        await workouts.register(normalized.id, normalized);
        workoutCount += 1;
      }

      let metricCount = 0;
      let sleepCount = 0;
      const storeSleep = async (nights: StoredSleep[]) => {
        for (const night of nights) {
          await sleep.register(sleepDayKey(night.date), night);
          sleepCount += 1;
        }
      };

      for (const raw of envelope.data.metrics ?? []) {
        // Sleep is structured (no scalar qty) and lives in its own namespace.
        if (isSleepMetricName(raw.name)) {
          await storeSleep(normalizeSleepPoints(raw.data));
          continue;
        }
        for (const point of normalizeMetricPoints(raw)) {
          await metrics.register(metricPointKey(point.name, point.date), point);
          metricCount += 1;
        }
      }
      await storeSleep(normalizeSleepPoints(envelope.data.sleepAnalysis));

      return { workouts: workoutCount, metrics: metricCount, sleep: sleepCount };
    },

    listWorkouts: readWorkouts,

    async summarize(filter: WorkoutFilter): Promise<WorkoutSummary> {
      const rows = await readWorkouts(filter);
      const byType = new Map<
        string,
        { count: number; durationSec: number; activeEnergy: number }
      >();
      let totalDurationSec = 0;
      let totalActiveEnergy = 0;
      for (const workout of rows) {
        const duration = workout.durationSec ?? 0;
        const energy = workout.activeEnergy ?? 0;
        totalDurationSec += duration;
        totalActiveEnergy += energy;
        const key = workout.name ?? "Unknown";
        const bucket = byType.get(key) ?? { count: 0, durationSec: 0, activeEnergy: 0 };
        bucket.count += 1;
        bucket.durationSec += duration;
        bucket.activeEnergy += energy;
        byType.set(key, bucket);
      }
      return {
        count: rows.length,
        totalDurationSec,
        totalActiveEnergy,
        byType: [...byType.entries()]
          .map(([name, value]) => ({
            name,
            count: value.count,
            durationSec: value.durationSec,
            activeEnergy: value.activeEnergy,
          }))
          .toSorted((a, b) => b.count - a.count),
      };
    },

    async listMetric(
      name: string,
      filter: { since?: string; until?: string },
    ): Promise<StoredMetricPoint[]> {
      const target = name.toLowerCase();
      const entries = await metrics.entries();
      const rows = entries
        .map((entry) => entry.value)
        .filter((point) => point.name.toLowerCase() === target)
        .filter((point) => inRange(point.date, filter.since, filter.until));
      return rows.toSorted((a, b) => a.date.localeCompare(b.date));
    },

    async listSleep(filter: { since?: string; until?: string }): Promise<StoredSleep[]> {
      const entries = await sleep.entries();
      const rows = entries
        .map((entry) => entry.value)
        .filter((night) => inRange(night.date, filter.since, filter.until));
      return rows.toSorted((a, b) => a.date.localeCompare(b.date));
    },
  };
}

export type HealthStore = ReturnType<typeof createHealthStore>;
