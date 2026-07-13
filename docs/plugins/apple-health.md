---
summary: "Apple Health plugin: ingest workouts and metrics from Health Auto Export, query them from the agent, and schedule recaps"
read_when:
  - You want Apple Health or Apple Watch workout data available to your agent
  - You are configuring the bundled apple-health plugin
title: "Apple Health plugin"
---

The Apple Health plugin ingests Apple Health data pushed from the iOS
[Health Auto Export](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069)
app, stores it, exposes an agent tool to query it, and can schedule a recurring
recap.

Apple provides no server-side API for Health data, so the data must originate on
the iPhone. Health Auto Export runs a scheduled background job that POSTs your
workouts and metrics as JSON to an authenticated route this plugin registers.

## Where it runs

The plugin runs inside the Gateway process. If your Gateway runs on another
machine, the iPhone must be able to reach that host over HTTP(S). Configure the
plugin on the Gateway host and restart the Gateway.

## Configure

Set config under `plugins.entries.apple-health.config`:

```json5
{
  plugins: {
    entries: {
      "apple-health": {
        enabled: true,
        config: {
          // Optional; defaults to /plugins/apple-health/ingest
          path: "/plugins/apple-health/ingest",
          // Bearer token Health Auto Export must present. Prefer a SecretRef.
          secret: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_APPLE_HEALTH_SECRET",
          },
          // Required only when summary.enabled is true.
          sessionKey: "agent:main:main",
          summary: {
            enabled: true,
            cron: "0 8 * * MON", // Monday 08:00
            tz: "America/Chicago",
          },
        },
      },
    },
  },
}
```

The `secret` may be a plain string or a SecretRef (`env` / `file` / `exec`), the
same shape used by the [Webhooks plugin](/plugins/webhooks). Without a `secret`
the plugin loads but registers nothing.

## Set up Health Auto Export

1. In Health Auto Export, create an automation of type **REST API**.
2. Set the URL to your Gateway plus the route, e.g.
   `https://gateway-host:PORT/plugins/apple-health/ingest`.
3. Add a header `Authorization: Bearer <your secret>`.
4. Choose **JSON** output and select **Workouts** plus a small set of metrics
   (for example resting heart rate, HRV, sleep, active energy). Exporting all
   150+ metric types is unnecessary and keeps stored data larger than needed.
5. Set the schedule (for example hourly or daily). Enable batching if your
   export is large.

To backfill history, run a one-time export over a wide date range through the
same automation; the plugin dedupes workouts by id, so re-sends are safe.

## Verify ingestion

```bash
curl -sS -X POST "https://gateway-host:PORT/plugins/apple-health/ingest" \
  -H "Authorization: Bearer $OPENCLAW_APPLE_HEALTH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"data":{"workouts":[{"id":"demo-1","name":"Run","start":"2026-07-01 06:00:00 -0500","duration":1800}],"metrics":[]}}'
# => {"ok":true,"workouts":1,"metrics":0}
```

## Query from the agent

The plugin registers the `apple_health_query` tool:

- `list_workouts` - workouts in a date range (`since`/`until`, optional `workoutType`).
- `summarize` - aggregate workouts (count, total duration/energy, breakdown by type).
- `latest` - the most recent workouts (`limit`).
- `metric` - samples for one `metricName` (for example `heart_rate`) in a range.
- `sleep` - nightly sleep records (total/deep/rem/core hours, in-bed, start/end) in a range.

Ask the agent naturally, e.g. "how did I train this week?" or "how did I sleep
last night?" and it will call the tool.

### Sleep

Sleep is structured per-night data (not a scalar metric), so it is stored in its
own `sleep` namespace and returned by the `sleep` action. To ingest it, enable
**Sleep Analysis** in Health Auto Export. Because HAE exports one data type per
automation, sleep needs its own automation (or include it in the metrics one if
your app version allows) pointing at the same URL and secret. The plugin accepts
sleep either as a `sleep_analysis` metric or a top-level `sleepAnalysis` array,
aggregated or unaggregated.

## Proactive recap

When `summary.enabled` is true, the plugin schedules a recurring agent turn (via
Cron) in `sessionKey` that summarizes the past week and delivers the recap to
that session's bound channel. Editing the config reschedules cleanly.

## Storage

Data is stored in the shared state database (`state/openclaw.sqlite`) through the
plugin key-value store: workouts keyed by id, metric samples keyed by
`name:date`. This suits personal volume. If you export a very large metric set,
consider narrowing the Health Auto Export selection.
