import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { PluginRuntime } from "../api.js";
import type { OpenClawConfig } from "../runtime-api.js";
import { createAppleHealthIngestHandler } from "./http.js";
import { createHealthStore } from "./store.js";

const PATH = "/plugins/apple-health/ingest";
const SECRET = "s3cret-token";

function fakeState(): PluginRuntime["state"] {
  const namespaces = new Map<
    string,
    Map<string, { key: string; value: unknown; createdAt: number }>
  >();
  const openKeyedStore = (options: { namespace: string }) => {
    let entries = namespaces.get(options.namespace);
    if (!entries) {
      entries = new Map();
      namespaces.set(options.namespace, entries);
    }
    const store = entries;
    return {
      async register(key: string, value: unknown) {
        store.set(key, { key, value, createdAt: 0 });
      },
      async registerIfAbsent() {
        return true;
      },
      async lookup(key: string) {
        return store.get(key)?.value;
      },
      async consume() {
        return undefined;
      },
      async delete(key: string) {
        return store.delete(key);
      },
      async entries() {
        return [...store.values()];
      },
      async clear() {
        store.clear();
      },
    };
  };
  return { openKeyedStore } as unknown as PluginRuntime["state"];
}

function makeReq(opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const req = Readable.from([Buffer.from(opts.body ?? "")]) as unknown as IncomingMessage & {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? "POST";
  req.url = PATH;
  req.headers = opts.headers ?? {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

type CapturedRes = ServerResponse & { statusCode: number; body: string };

function makeRes(): CapturedRes {
  const res = {
    statusCode: 200,
    body: "",
    headers: {} as Record<string, unknown>,
    setHeader(key: string, value: unknown) {
      this.headers[key] = value;
    },
    getHeader(key: string) {
      return this.headers[key];
    },
    writeHead(code: number, headers?: Record<string, unknown>) {
      this.statusCode = code;
      if (headers) {
        Object.assign(this.headers, headers);
      }
      return this;
    },
    write(chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
      return true;
    },
    end(chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
      return this;
    },
  };
  return res as unknown as CapturedRes;
}

function buildHandler(store = createHealthStore(fakeState())) {
  return {
    store,
    handler: createAppleHealthIngestHandler({
      cfg: {} as OpenClawConfig,
      target: {
        path: PATH,
        secretInput: SECRET,
        secretConfigPath: "plugins.entries.apple-health.config.secret",
        store,
      },
    }),
  };
}

const validBody = JSON.stringify({
  data: {
    workouts: [{ id: "w1", name: "Run", start: "2026-07-01 06:00:00 -0500", duration: 1800 }],
    metrics: [],
  },
});

describe("createAppleHealthIngestHandler", () => {
  it("rejects a request with no secret", async () => {
    const { handler } = buildHandler();
    const res = makeRes();
    await handler(
      makeReq({ headers: { "content-type": "application/json" }, body: validBody }),
      res,
    );
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const { handler } = buildHandler();
    const res = makeRes();
    await handler(
      makeReq({
        headers: { "content-type": "application/json", authorization: "Bearer nope" },
        body: validBody,
      }),
      res,
    );
    expect(res.statusCode).toBe(401);
  });

  it("stores data and returns counts for a valid authenticated POST", async () => {
    const { handler, store } = buildHandler();
    const res = makeRes();
    await handler(
      makeReq({
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: validBody,
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, workouts: 1, metrics: 0, sleep: 0 });
    expect(await store.listWorkouts({})).toHaveLength(1);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const { handler } = buildHandler();
    const res = makeRes();
    await handler(
      makeReq({
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: "{ not json",
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a body missing the data envelope", async () => {
    const { handler } = buildHandler();
    const res = makeRes();
    await handler(
      makeReq({
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ workouts: [] }),
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});
