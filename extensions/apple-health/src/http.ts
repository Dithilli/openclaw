// Apple Health plugin module implements authenticated ingestion.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { PluginLogger } from "../api.js";
import {
  createFixedWindowRateLimiter,
  createWebhookInFlightLimiter,
  normalizeLowercaseStringOrEmpty,
  readJsonWebhookBodyOrReject,
  resolveConfiguredSecretInputString,
  resolveRequestClientIp,
  resolveWebhookTargetWithAuthOrReject,
  safeEqualSecret,
  withResolvedWebhookRequestPipeline,
  WEBHOOK_IN_FLIGHT_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  type OpenClawConfig,
} from "../runtime-api.js";
import type { AppleHealthSecretInput } from "./config.js";
import { healthExportEnvelopeSchema } from "./schema.js";
import type { HealthStore } from "./store.js";

export type AppleHealthIngestTarget = {
  path: string;
  secretInput: AppleHealthSecretInput;
  secretConfigPath: string;
  store: HealthStore;
};

// Health Auto Export batches - and one-shot historical backfills - can be large,
// so allow 8 MiB. Users with bigger exports should enable HAE request batching.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function extractSharedSecret(req: IncomingMessage): string {
  const authHeader = Array.isArray(req.headers.authorization)
    ? (req.headers.authorization[0] ?? "")
    : (req.headers.authorization ?? "");
  if (normalizeLowercaseStringOrEmpty(authHeader).startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }
  const sharedHeader = req.headers["x-openclaw-webhook-secret"];
  return Array.isArray(sharedHeader) ? (sharedHeader[0] ?? "").trim() : (sharedHeader ?? "").trim();
}

function formatZodError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return "invalid request";
  }
  const path = firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";
  return `${path}${firstIssue.message}`;
}

export function createAppleHealthIngestHandler(params: {
  cfg: OpenClawConfig;
  target: AppleHealthIngestTarget;
  logger?: PluginLogger;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const targetsByPath = new Map<string, AppleHealthIngestTarget[]>([
    [params.target.path, [params.target]],
  ]);
  const rateLimiter = createFixedWindowRateLimiter({
    windowMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
    maxRequests: WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests,
    maxTrackedKeys: WEBHOOK_RATE_LIMIT_DEFAULTS.maxTrackedKeys,
  });
  const inFlightLimiter = createWebhookInFlightLimiter({
    maxInFlightPerKey: WEBHOOK_IN_FLIGHT_DEFAULTS.maxInFlightPerKey,
    maxTrackedKeys: WEBHOOK_IN_FLIGHT_DEFAULTS.maxTrackedKeys,
  });

  const resolveTargetSecret = async (
    target: AppleHealthIngestTarget,
  ): Promise<string | undefined> => {
    if (typeof target.secretInput === "string") {
      return target.secretInput;
    }
    const resolved = await resolveConfiguredSecretInputString({
      config: params.cfg,
      env: process.env,
      value: target.secretInput,
      path: target.secretConfigPath,
    });
    return resolved.value;
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    return await withResolvedWebhookRequestPipeline({
      req,
      res,
      targetsByPath,
      allowMethods: ["POST"],
      requireJsonContentType: true,
      rateLimiter,
      rateLimitKey: (() => {
        const clientIp =
          resolveRequestClientIp(
            req,
            params.cfg.gateway?.trustedProxies,
            params.cfg.gateway?.allowRealIpFallback === true,
          ) ??
          req.socket.remoteAddress ??
          "unknown";
        return `${new URL(req.url ?? "/", "http://localhost").pathname}:${clientIp}`;
      })(),
      inFlightLimiter,
      handle: async ({ targets }) => {
        const presentedSecret = extractSharedSecret(req);
        const target = await resolveWebhookTargetWithAuthOrReject({
          targets,
          res,
          isMatch: async (candidate) => {
            if (presentedSecret.length === 0) {
              return false;
            }
            const resolvedSecret = await resolveTargetSecret(candidate);
            return Boolean(resolvedSecret && safeEqualSecret(resolvedSecret, presentedSecret));
          },
        });
        if (!target) {
          return true;
        }

        const body = await readJsonWebhookBodyOrReject({
          req,
          res,
          maxBytes: MAX_BODY_BYTES,
          timeoutMs: 15_000,
          emptyObjectOnEmpty: false,
          invalidJsonMessage: "invalid request body",
        });
        if (!body.ok) {
          return true;
        }

        const parsed = healthExportEnvelopeSchema.safeParse(body.value);
        if (!parsed.success) {
          writeJson(res, 400, {
            ok: false,
            code: "invalid_request",
            error: formatZodError(parsed.error),
          });
          return true;
        }

        try {
          const counts = await target.store.ingest(parsed.data);
          writeJson(res, 200, { ok: true, ...counts });
        } catch (error) {
          params.logger?.error?.(`[apple-health] ingest failed: ${String(error)}`);
          writeJson(res, 500, {
            ok: false,
            code: "ingest_failed",
            error: "failed to store health data",
          });
        }
        return true;
      },
    });
  };
}
