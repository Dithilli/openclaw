// Apple Health plugin module exposes the agent query tool.
import type { AnyAgentTool, OpenClawPluginToolContext } from "../api.js";
import { AppleHealthQuerySchema, type AppleHealthQueryParams } from "./schema.js";
import type { HealthStore } from "./store.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function textResult(text: string, details: unknown) {
  return { content: [{ type: "text" as const, text }], details };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function createHealthQueryTool(
  store: HealthStore,
  _toolContext: OpenClawPluginToolContext = {},
): AnyAgentTool {
  return {
    name: "apple_health_query",
    label: "Apple Health",
    description:
      "Query Apple Health workouts and metrics ingested from Health Auto Export.\n" +
      "list_workouts: workouts in a date range (since/until ISO dates, optional workoutType filter).\n" +
      "summarize: aggregate workouts in a range (count, total duration/energy, breakdown by type).\n" +
      "latest: most recent workouts (use limit).\n" +
      "metric: samples for one metricName (e.g. heart_rate, resting_heart_rate) in a range.",
    parameters: AppleHealthQuerySchema,
    async execute(_toolCallId, params) {
      const query = (params ?? {}) as AppleHealthQueryParams;
      const limit = clampLimit(query.limit);
      const filter = {
        since: query.since,
        until: query.until,
        workoutType: query.workoutType,
      };

      switch (query.action) {
        case "summarize": {
          const summary = await store.summarize(filter);
          return textResult(JSON.stringify(summary), summary);
        }
        case "latest": {
          const rows = (await store.listWorkouts(filter)).slice(-limit).toReversed();
          return textResult(JSON.stringify(rows), { workouts: rows });
        }
        case "metric": {
          if (!query.metricName) {
            return textResult("metricName is required for action=metric.", {
              error: "metricName_required",
            });
          }
          const rows = (await store.listMetric(query.metricName, filter)).slice(-limit);
          return textResult(JSON.stringify(rows), { metric: query.metricName, points: rows });
        }
        default: {
          const rows = (await store.listWorkouts(filter)).slice(0, limit);
          return textResult(JSON.stringify(rows), { workouts: rows });
        }
      }
    },
  };
}
