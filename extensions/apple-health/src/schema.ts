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
        // Some HAE versions deliver sleep as a top-level array instead of a
        // metric named "sleep_analysis"; accept both (see store ingest).
        sleepAnalysis: z.array(metricDatumSchema).optional(),
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

/** One night of sleep persisted in the KV store, keyed by day (YYYY-MM-DD). */
export type StoredSleep = {
  date: string;
  totalSleepHr?: number;
  deepHr?: number;
  remHr?: number;
  coreHr?: number;
  awakeHr?: number;
  inBedHr?: number;
  start?: string;
  end?: string;
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

// Sleep arrives either as a metric named "sleep_analysis" or a top-level
// `data.sleepAnalysis` array. Match the exact name so scalar metrics that merely
// contain "sleep" (e.g. apple_sleeping_wrist_temperature) are NOT treated as sleep.
export function isSleepMetricName(name: string | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return n === "sleep_analysis" || n === "sleepanalysis";
}

/** Per-night dedupe key: the YYYY-MM-DD day of the sleep record. */
export function sleepDayKey(date: string): string {
  return date.slice(0, 10);
}

// A gap in wall-clock with no recorded segment marks a separate sleep period
// (e.g. a nap vs the main night). Within a session, Apple emits contiguous
// segments (awake time is its own segment), so real gaps only fall between sessions.
const SLEEP_SESSION_GAP_MS = 60 * 60 * 1000;

/** Parse HAE's "YYYY-MM-DD HH:MM:SS -0700" into epoch ms (NaN if unparseable). */
function parseHaeDateMs(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const iso = value.replace(" ", "T").replace(/\s*([+-]\d{2})(\d{2})$/u, "$1:$2");
  return Date.parse(iso);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type SleepSegment = { start: string; end?: string; stage: string; qty: number; startMs: number };

/** Aggregate one contiguous session's stage segments into a stored night. */
function sessionToNight(segments: SleepSegment[]): StoredSleep {
  let core = 0;
  let deep = 0;
  let rem = 0;
  let awake = 0;
  let unspecified = 0;
  for (const seg of segments) {
    switch (seg.stage) {
      case "core":
        core += seg.qty;
        break;
      case "deep":
        deep += seg.qty;
        break;
      case "rem":
        rem += seg.qty;
        break;
      case "awake":
        awake += seg.qty;
        break;
      case "asleep":
      case "asleepunspecified":
        unspecified += seg.qty;
        break;
      default:
        // "inbed" and unknown stages are ignored for the asleep total.
        break;
    }
  }
  const asleep = core + deep + rem + unspecified;
  const first = segments[0];
  const last = segments[segments.length - 1];
  return withOptional<StoredSleep>(
    { date: first.start },
    {
      totalSleepHr: round2(asleep),
      deepHr: deep > 0 ? round2(deep) : undefined,
      remHr: rem > 0 ? round2(rem) : undefined,
      coreHr: core > 0 ? round2(core) : undefined,
      awakeHr: awake > 0 ? round2(awake) : undefined,
      inBedHr: round2(asleep + awake),
      start: first.start,
      end: last.end ?? last.start,
    },
  );
}

/**
 * Normalize HAE sleep into stored nights. Handles both real shapes:
 * - unaggregated stage segments (Summarize OFF): each point has a stage `value`
 *   ("Core"/"Deep"/"REM"/"Awake") and `qty` hours; grouped into sessions.
 * - aggregated per-night objects (Summarize ON): `totalSleep`/`deep`/`rem`/...
 */
export function normalizeSleepPoints(dataPoints: unknown[] | undefined): StoredSleep[] {
  const segments: SleepSegment[] = [];
  const aggregated: StoredSleep[] = [];
  for (const datum of dataPoints ?? []) {
    if (!datum || typeof datum !== "object") {
      continue;
    }
    const r = datum as Record<string, unknown>;
    const stage = asString(r.value);
    const qty = asNumber(r.qty);
    const start = asString(r.start) ?? asString(r.startDate) ?? asString(r.date);
    if (stage && qty !== undefined && start) {
      segments.push({
        start,
        end: asString(r.end) ?? asString(r.endDate),
        stage: stage.toLowerCase(),
        qty,
        startMs: parseHaeDateMs(start),
      });
      continue;
    }
    // Aggregated per-night fallback.
    const date = asString(r.date) ?? start;
    if (date && (asNumber(r.totalSleep) !== undefined || asNumber(r.asleep) !== undefined)) {
      aggregated.push(
        withOptional<StoredSleep>(
          { date },
          {
            totalSleepHr: asNumber(r.totalSleep) ?? asNumber(r.asleep),
            deepHr: asNumber(r.deep),
            remHr: asNumber(r.rem),
            coreHr: asNumber(r.core),
            awakeHr: asNumber(r.awake),
            inBedHr: asNumber(r.inBed),
            start: asString(r.sleepStart) ?? asString(r.startDate),
            end: asString(r.sleepEnd) ?? asString(r.endDate),
          },
        ),
      );
    }
  }

  if (segments.length === 0) {
    return aggregated;
  }
  segments.sort((a, b) => a.startMs - b.startMs || a.start.localeCompare(b.start));
  const sessions: SleepSegment[][] = [];
  let current: SleepSegment[] = [];
  let prevEndMs = Number.NaN;
  for (const seg of segments) {
    const isNewSession =
      current.length > 0 &&
      Number.isFinite(seg.startMs) &&
      Number.isFinite(prevEndMs) &&
      seg.startMs - prevEndMs > SLEEP_SESSION_GAP_MS;
    if (isNewSession) {
      sessions.push(current);
      current = [];
    }
    current.push(seg);
    const endMs = parseHaeDateMs(seg.end);
    prevEndMs = Number.isFinite(endMs) ? endMs : seg.startMs;
  }
  if (current.length > 0) {
    sessions.push(current);
  }
  return [...aggregated, ...sessions.map(sessionToNight)];
}

// Tool parameter schema. Flat JSON Schema with a string `enum` discriminator so
// providers that reject `anyOf` still accept it (per repo tool-schema policy).
export const AppleHealthQuerySchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      description:
        "list_workouts=return workouts in a date range; summarize=aggregate workouts (count, total duration/energy); latest=most recent workouts; metric=return samples for one metric name; sleep=return nightly sleep records (total/deep/rem/core hours) in a date range.",
      enum: ["list_workouts", "summarize", "latest", "metric", "sleep"],
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
  action: "list_workouts" | "summarize" | "latest" | "metric" | "sleep";
  since?: string;
  until?: string;
  workoutType?: string;
  metricName?: string;
  limit?: number;
};
