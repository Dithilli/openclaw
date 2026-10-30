// Covers heartbeat enrollment against the map-shaped `agents.entries` config.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveHeartbeatAgents } from "./heartbeat-runner.js";
import { isHeartbeatEnabledForAgent } from "./heartbeat-summary.js";

const cfg = {
  agents: {
    defaults: { heartbeat: { every: "6h" } },
    entries: {
      main: { default: true, heartbeat: { every: "1h" } },
      worker: { model: "sonnet-4.6" },
    },
  },
} as OpenClawConfig;

describe("heartbeat enrollment with agents.entries", () => {
  it("enrolls only the agent with an explicit heartbeat block", () => {
    expect(resolveHeartbeatAgents(cfg).map((agent) => agent.agentId)).toEqual(["main"]);
  });

  it("treats agents without a heartbeat block as disabled", () => {
    expect(isHeartbeatEnabledForAgent(cfg, "main")).toBe(true);
    expect(isHeartbeatEnabledForAgent(cfg, "worker")).toBe(false);
  });
});
