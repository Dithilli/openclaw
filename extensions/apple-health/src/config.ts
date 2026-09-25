// Apple Health helper module resolves plugin configuration.
import { z } from "zod";
import { normalizeWebhookPath } from "../runtime-api.js";

const secretRefSchema = z
  .object({
    source: z.enum(["env", "file", "exec"]),
    provider: z.string().trim().min(1),
    id: z.string().trim().min(1),
  })
  .strict();

const secretInputSchema = z.union([z.string().trim().min(1), secretRefSchema]);

const summaryConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    cron: z.string().trim().min(1).optional(),
    tz: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
  })
  .strict();

const appleHealthPluginConfigSchema = z
  .object({
    path: z.string().trim().min(1).optional(),
    // Optional so an enabled-but-unconfigured plugin no-ops instead of throwing at startup.
    secret: secretInputSchema.optional(),
    sessionKey: z.string().trim().min(1).optional(),
    summary: summaryConfigSchema.optional(),
  })
  .strict();

export type AppleHealthSecretInput = z.infer<typeof secretInputSchema>;

export type AppleHealthSummaryConfig = {
  cron: string;
  sessionKey: string;
  tz?: string;
  agentId?: string;
};

export type ResolvedAppleHealthConfig = {
  path: string;
  secret: AppleHealthSecretInput;
  secretConfigPath: string;
  summary: AppleHealthSummaryConfig | null;
};

const DEFAULT_PATH = "/plugins/apple-health/ingest";
const DEFAULT_SUMMARY_CRON = "0 8 * * MON";

/**
 * Returns the resolved config, or null when the plugin is present but not
 * configured with a secret. A malformed config (wrong types) still throws.
 */
export function resolveAppleHealthConfig(params: {
  pluginConfig: unknown;
}): ResolvedAppleHealthConfig | null {
  const parsed = appleHealthPluginConfigSchema.parse(params.pluginConfig ?? {});
  if (!parsed.secret) {
    return null;
  }

  let summary: AppleHealthSummaryConfig | null = null;
  if (parsed.summary?.enabled) {
    if (!parsed.sessionKey) {
      throw new Error(
        "apple-health.summary.enabled requires apple-health.sessionKey to deliver the recap.",
      );
    }
    summary = {
      cron: parsed.summary.cron ?? DEFAULT_SUMMARY_CRON,
      sessionKey: parsed.sessionKey,
      ...(parsed.summary.tz ? { tz: parsed.summary.tz } : {}),
      ...(parsed.summary.agentId ? { agentId: parsed.summary.agentId } : {}),
    };
  }

  return {
    path: normalizeWebhookPath(parsed.path ?? DEFAULT_PATH),
    secret: parsed.secret,
    secretConfigPath: "plugins.entries.apple-health.config.secret",
    summary,
  };
}
