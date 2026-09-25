// Apple Health runtime module re-exports the SDK helpers used by the plugin.
export {
  createFixedWindowRateLimiter,
  createWebhookInFlightLimiter,
  normalizeWebhookPath,
  readJsonWebhookBodyOrReject,
  resolveRequestClientIp,
  resolveWebhookTargetWithAuthOrReject,
  withResolvedWebhookRequestPipeline,
  WEBHOOK_IN_FLIGHT_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  type WebhookInFlightLimiter,
} from "openclaw/plugin-sdk/webhook-ingress";
export { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";
export { safeEqualSecret } from "openclaw/plugin-sdk/security-runtime";
export { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
export type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
