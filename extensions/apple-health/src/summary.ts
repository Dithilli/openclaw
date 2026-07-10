// Apple Health plugin module schedules the proactive recap turn.
import type { OpenClawPluginApi } from "../api.js";
import type { AppleHealthSummaryConfig } from "./config.js";

const SUMMARY_TAG = "apple-health-summary";
const SUMMARY_MESSAGE =
  "Weekly Apple Health training recap. Call apple_health_query with action=summarize for the past 7 days " +
  "(set `since` to seven days ago), then write a short, friendly recap of the workouts: counts by type, " +
  "total active time and energy, and any notable change from usual. If there is no data, say so briefly.";

/**
 * (Re)schedule the recurring recap. Clears the prior tag first so config edits
 * do not stack duplicate cron jobs across restarts.
 */
export async function scheduleHealthSummary(
  api: OpenClawPluginApi,
  summary: AppleHealthSummaryConfig,
): Promise<void> {
  await api.session.workflow.unscheduleSessionTurnsByTag({
    sessionKey: summary.sessionKey,
    tag: SUMMARY_TAG,
  });
  await api.session.workflow.scheduleSessionTurn({
    cron: summary.cron,
    ...(summary.tz ? { tz: summary.tz } : {}),
    sessionKey: summary.sessionKey,
    message: SUMMARY_MESSAGE,
    ...(summary.agentId ? { agentId: summary.agentId } : {}),
    deliveryMode: "announce",
    tag: SUMMARY_TAG,
  });
}
