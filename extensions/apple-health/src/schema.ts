// Apple Health helper module validates payloads and normalizes stored records.
import { z } from "zod";

// Health Auto Export evolves its schema and carries 150+ metric shapes, so the
// envelope stays permissive (passthrough) and normalization happens in code.
const workoutSchema = z.object({}).passthrough();
const metricDatumSchema = z.object({}).passthrough();
const metricSchema = z
  .object({
    name: z.string().trim().min(1),
    units: z.string().optional(),
    data: z.array(metricDatumSchema).optional(),
  })
  .passthrough();

export const healthExportEnvelopeSchema = z
  .object({
    data: z
      .object({
        workouts: z.array(workoutSchema).optional(),
        metrics: z.array(metricSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type HealthExportEnvelope = z.infer<typeof healthExportEnvelopeSchema>;

/** Compact, bounded workout record persisted in the KV store. */
export type StoredWorkout = {
  id: string;
  name?: string;
  start?: string;
  end?: string;
  durationSec?: number;
  activeEnergy?: number;
  distance?: number;
};

/** One metric sample persisted in the KV store, keyed by `name:date`. */
export type StoredMetricPoint = {
  name: string;
  date: string;
  qty: number;
  units?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// Health Auto Export encodes quantities either as a bare number or as a
// `{ qty, units }` object depending on the field; accept both.
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === "object" && "qty" in value) {
    const qty = (value as { qty: unknown }).qty;
    if (typeof qty === "number" && Number.isFinite(qty)) {
      return qty;
    }
  }
  return undefined;
}

function withOptional<T extends object>(base: T, extra: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

/**
 * Normalize one raw workout into a stored record. Returns null when no stable
 * key can be derived (HAE usually supplies `id`; otherwise fall back to
 * `name:start`, then `start`).
 */
export function normalizeWorkout(raw: Record<string, unknown>): StoredWorkout | null {
  const name = asString(raw.name);
  const start = asString(raw.start);
  const id = asString(raw.id) ?? (name && start ? `${name}:${start}` : start);
  if (!id) {
    return null;
  }
  return withOptional<StoredWorkout>(
    { id },
    {
      name,
      start,
      end: asString(raw.end),
      durationSec: asNumber(raw.duration),
      activeEnergy: asNumber(raw.activeEnergyBurned) ?? asNumber(raw.activeEnergy),
      distance: asNumber(raw.distance),
    },
  );
}

/** Flatten one raw metric's samples into stored points keyed by `name:date`. */
export function normalizeMetricPoints(raw: {
  name: string;
  units?: string;
  data?: unknown[];
}): StoredMetricPoint[] {
  const points: StoredMetricPoint[] = [];
  for (const datum of raw.data ?? []) {
    if (!datum || typeof datum !== "object") {
      continue;
    }
    const record = datum as Record<string, unknown>;
    const date = asString(record.date);
    const qty = asNumber(record.qty) ?? asNumber(record.Avg) ?? asNumber(record.avg);
    if (!date || qty === undefined) {
      continue;
    }
    points.push(
      withOptional<StoredMetricPoint>({ name: raw.name, date, qty }, { units: raw.units }),
    );
  }
  return points;
}

export function metricPointKey(name: string, date: string): string {
  return `${name}:${date}`;
}

// Tool parameter schema. Flat JSON Schema with a string `enum` discriminator so
// providers that reject `anyOf` still accept it (per repo tool-schema policy).
export const AppleHealthQuerySchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      description:
        "list_workouts=return workouts in a date range; summarize=aggregate workouts (count, total duration/energy); latest=most recent workouts; metric=return samples for one metric name.",
      enum: ["list_workouts", "summarize", "latest", "metric"],
    },
    since: {
      type: "string",
      description: "Optional inclusive lower bound as an ISO date/datetime, e.g. 2026-07-01.",
    },
    until: {
      type: "string",
      description: "Optional inclusive upper bound as an ISO date/datetime.",
    },
    workoutType: {
      type: "string",
      description: "Optional workout-name filter, e.g. 'Traditional Strength Training'.",
    },
    metricName: {
      type: "string",
      description: "Metric name for action=metric, e.g. 'heart_rate' or 'resting_heart_rate'.",
    },
    limit: {
      type: "number",
      description: "Max rows to return (default 50, max 500).",
    },
  },
  required: ["action"],
} as const;

export type AppleHealthQueryParams = {
  action: "list_workouts" | "summarize" | "latest" | "metric";
  since?: string;
  until?: string;
  workoutType?: string;
  metricName?: string;
  limit?: number;
};
