// Apple Health plugin entrypoint registers ingestion, query tool, and summary.
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { resolveAppleHealthConfig } from "./src/config.js";
import { createAppleHealthIngestHandler } from "./src/http.js";
import { createHealthStore } from "./src/store.js";
import { scheduleHealthSummary } from "./src/summary.js";
import { createHealthQueryTool } from "./src/tool.js";

function registerAppleHealth(api: OpenClawPluginApi): void {
  const config = resolveAppleHealthConfig({ pluginConfig: api.pluginConfig });
  if (!config) {
    api.logger.info?.("[apple-health] no secret configured; skipping route/tool registration");
    return;
  }

  const store = createHealthStore(api.runtime.state);

  const handler = createAppleHealthIngestHandler({
    cfg: api.config,
    target: {
      path: config.path,
      secretInput: config.secret,
      secretConfigPath: config.secretConfigPath,
      store,
    },
    logger: api.logger,
  });

  api.registerHttpRoute({
    path: config.path,
    auth: "plugin",
    match: "exact",
    replaceExisting: true,
    handler,
  });

  api.registerTool((ctx) => createHealthQueryTool(store, ctx), { name: "apple_health_query" });

  api.logger.info?.(`[apple-health] ingestion route ready on ${config.path}`);

  if (config.summary) {
    // Fire-and-forget: register() is synchronous but the Cron scheduler is async.
    void scheduleHealthSummary(api, config.summary).catch((error: unknown) => {
      api.logger.error?.(`[apple-health] failed to schedule summary: ${String(error)}`);
    });
  }
}

export default definePluginEntry({
  id: "apple-health",
  name: "Apple Health",
  description:
    "Ingest Apple Health workouts and metrics from Health Auto Export, query them from the agent, and schedule proactive summaries.",
  register(api: OpenClawPluginApi) {
    registerAppleHealth(api);
  },
});
