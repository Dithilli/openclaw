import { describe, expect, it } from "vitest";
import { resolveAppleHealthConfig } from "./config.js";

describe("resolveAppleHealthConfig", () => {
  it("returns null when no secret is configured", () => {
    expect(resolveAppleHealthConfig({ pluginConfig: {} })).toBeNull();
    expect(resolveAppleHealthConfig({ pluginConfig: undefined })).toBeNull();
  });

  it("defaults the path and leaves summary disabled", () => {
    const config = resolveAppleHealthConfig({ pluginConfig: { secret: "s3cret" } });
    expect(config?.path).toBe("/plugins/apple-health/ingest");
    expect(config?.secret).toBe("s3cret");
    expect(config?.summary).toBeNull();
  });

  it("resolves the summary with defaults when enabled", () => {
    const config = resolveAppleHealthConfig({
      pluginConfig: { secret: "s", sessionKey: "main", summary: { enabled: true } },
    });
    expect(config?.summary).toEqual({ cron: "0 8 * * MON", sessionKey: "main" });
  });

  it("throws when summary is enabled without a sessionKey", () => {
    expect(() =>
      resolveAppleHealthConfig({ pluginConfig: { secret: "s", summary: { enabled: true } } }),
    ).toThrow(/sessionKey/);
  });

  it("passes through a custom path and secret ref", () => {
    const config = resolveAppleHealthConfig({
      pluginConfig: {
        secret: { source: "env", provider: "env", id: "HAE_SECRET" },
        path: "/hae",
      },
    });
    expect(config?.path).toBe("/hae");
    expect(config?.secret).toEqual({ source: "env", provider: "env", id: "HAE_SECRET" });
  });
});
