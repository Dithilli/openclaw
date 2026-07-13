// Apple Health plugin module implements the setup CLI.
import { randomBytes } from "node:crypto";
import type { Command } from "commander";

const DEFAULT_PATH = "/plugins/apple-health/ingest";

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

function printSetup(): void {
  const secret = generateSecret();
  const lines = [
    "Apple Health ingestion setup",
    "",
    "1) Add this plugin to your OpenClaw config (openclaw.json):",
    "",
    '   "plugins": {',
    '     "allow": [ ..., "apple-health" ],',
    '     "entries": {',
    '       "apple-health": { "enabled": true, "config": {',
    `         "secret": "${secret}"`,
    "       } }",
    "     }",
    "   }",
    "",
    "   (Then rebuild/restart the gateway so the route loads.)",
    "",
    "2) Expose the gateway to your phone. The plugin serves:",
    `      POST <your-public-gateway-url>${DEFAULT_PATH}`,
    "   Use a tunnel if the gateway isn't already internet-reachable",
    "   (Cloudflare Tunnel is a good free option; ngrok also works).",
    "",
    "3) In the Health Auto Export app, create a REST API automation:",
    `      URL:     <your-public-gateway-url>${DEFAULT_PATH}`,
    "      Header:  x-openclaw-webhook-secret = <the secret above>",
    "               (or Authorization: Bearer <secret>)",
    "      Format:  JSON",
    "      Data:    one automation per type (Workouts / Health Metrics).",
    "               For sleep, add Sleep Analysis with Summarize Data OFF.",
    "",
    'A successful post returns: {"ok":true,"workouts":N,"metrics":M,"sleep":K}',
    'Then ask your agent (e.g. "how did I sleep this week?") to read the data.',
  ];
  console.log(lines.join("\n"));
}

export function registerAppleHealthCli(program: Command): void {
  program
    .command("apple-health")
    .description("Apple Health ingestion setup")
    .command("setup")
    .description("Generate a secret and print Health Auto Export setup instructions")
    .action(() => {
      printSetup();
    });
}
