// Venice video generation: queue a job on /video/queue, poll /video/retrieve
// until the mp4 bytes come back. Model constraints come from the live catalog.
import { extensionForMime } from "openclaw/plugin-sdk/media-mime";
import { resolvePositiveTimerTimeoutMs } from "openclaw/plugin-sdk/number-runtime";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import { getCachedLiveProviderModelRows } from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import {
  assertOkOrThrowHttpError,
  createProviderOperationDeadline,
  type ProviderOperationDeadline,
  readProviderJsonResponse,
  resolveProviderOperationTimeoutMs,
  waitProviderOperationPollInterval,
} from "openclaw/plugin-sdk/provider-http";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { isRecord, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type {
  GeneratedVideoAsset,
  VideoGenerationModeCapabilities,
  VideoGenerationProvider,
  VideoGenerationProviderCapabilities,
  VideoGenerationRequest,
  VideoGenerationResolution,
  VideoGenerationSourceAsset,
} from "openclaw/plugin-sdk/video-generation";
import { VENICE_ALLOWED_HOSTNAMES, VENICE_BASE_URL } from "./models.js";

const PROVIDER_ID = "venice";
// Venice encodes the input mode in the model id. The text/image pair below is
// the plugin default; callers who omit `model` and attach an image get the
// image-to-video sibling instead of a guaranteed 400 from the text model.
const DEFAULT_TEXT_TO_VIDEO_MODEL = "wan-3-0-text-to-video";
const DEFAULT_IMAGE_TO_VIDEO_MODEL = "wan-3-0-image-to-video";
const DEFAULT_DURATION_SECONDS = 5;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 1_200_000;
const DEFAULT_GENERATED_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const POLL_INTERVAL_MS = 5_000;
const LIVE_CATALOG_TIMEOUT_MS = 10_000;
// Video constraints change when Venice adds models, not per request; cache
// them well past the text catalog's 60s so polling loops never refetch.
const LIVE_CATALOG_TTL_MS = 10 * 60 * 1000;
const VENICE_VIDEO_MALFORMED_RESPONSE = "venice video generation response malformed";

// Advisory list for `video_generate action=list`; any live Venice video model id is accepted.
const VENICE_VIDEO_MODELS = [
  DEFAULT_TEXT_TO_VIDEO_MODEL,
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  "wan-3-0-reference-to-video",
  "seedance-2-0-text-to-video-basic",
  "seedance-2-0-image-to-video-basic",
  "kling-v3-pro-text-to-video",
  "kling-v3-pro-image-to-video",
  "veo3.1-fast-text-to-video",
  "veo3.1-fast-image-to-video",
  "minimax-h3-text-to-video",
  "minimax-h3-image-to-video",
];
const VENICE_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const VENICE_VIDEO_RESOLUTIONS: VideoGenerationResolution[] = ["480P", "720P", "1080P"];

type VeniceVideoConstraints = {
  modelType: "text-to-video" | "image-to-video" | "video";
  durations: number[];
  aspectRatios: string[];
  resolutions: VideoGenerationResolution[];
  audioConfigurable: boolean;
  audioInput: boolean;
  videoInput: boolean;
};

let veniceVideoFetchGuard = fetchWithSsrFGuard;

export function setVeniceVideoFetchGuardForTesting(impl: typeof fetchWithSsrFGuard | null): void {
  veniceVideoFetchGuard = impl ?? fetchWithSsrFGuard;
}

function parseDurationSeconds(value: unknown): number | undefined {
  const match = /^(\d{1,3})s$/iu.exec(normalizeOptionalString(value) ?? "");
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = normalizeOptionalString(entry);
        return normalized ? [normalized] : [];
      })
    : [];
}

// Venice constraint ids are lowercase (`720p`, `4k`); core resolution labels are uppercase.
function toCoreResolution(value: string): VideoGenerationResolution {
  return value.toUpperCase();
}

function readVeniceVideoConstraints(row: unknown): VeniceVideoConstraints | undefined {
  if (!isRecord(row) || !isRecord(row.model_spec) || !isRecord(row.model_spec.constraints)) {
    return undefined;
  }
  const constraints = row.model_spec.constraints;
  const modelType = normalizeOptionalString(constraints.model_type);
  if (modelType !== "text-to-video" && modelType !== "image-to-video" && modelType !== "video") {
    return undefined;
  }
  return {
    modelType,
    durations: readStringList(constraints.durations).flatMap((entry) => {
      const seconds = parseDurationSeconds(entry);
      return seconds === undefined ? [] : [seconds];
    }),
    aspectRatios: readStringList(constraints.aspect_ratios),
    resolutions: readStringList(constraints.resolutions).map(toCoreResolution),
    audioConfigurable: constraints.audio_configurable === true,
    audioInput: constraints.audio_input === true,
    videoInput: constraints.video_input === true,
  };
}

async function fetchVeniceVideoConstraints(
  model: string,
): Promise<VeniceVideoConstraints | undefined> {
  const rows = await getCachedLiveProviderModelRows({
    providerId: PROVIDER_ID,
    endpoint: `${VENICE_BASE_URL}/models?type=video`,
    timeoutMs: LIVE_CATALOG_TIMEOUT_MS,
    ttlMs: LIVE_CATALOG_TTL_MS,
    policy: { allowedHostnames: VENICE_ALLOWED_HOSTNAMES },
    auditContext: "venice-video-model-discovery",
    shouldCacheRows: (candidate) => candidate.length > 0,
  });
  const row = rows.find((entry) => isRecord(entry) && entry.id === model);
  return row ? readVeniceVideoConstraints(row) : undefined;
}

function modeCapabilitiesFromConstraints(
  constraints: VeniceVideoConstraints,
): VideoGenerationModeCapabilities {
  return {
    ...(constraints.durations.length > 0
      ? {
          supportedDurationSeconds: constraints.durations,
          maxDurationSeconds: Math.max(...constraints.durations),
        }
      : {}),
    ...(constraints.aspectRatios.length > 0 ? { aspectRatios: constraints.aspectRatios } : {}),
    ...(constraints.resolutions.length > 0 ? { resolutions: constraints.resolutions } : {}),
    supportsAspectRatio: constraints.aspectRatios.length > 0,
    supportsResolution: constraints.resolutions.length > 0,
    supportsAudio: constraints.audioConfigurable,
  };
}

export function capabilitiesFromVeniceVideoConstraints(
  model: string,
  constraints: VeniceVideoConstraints,
): VideoGenerationProviderCapabilities {
  const isReferenceModel = model.includes("reference-to-video");
  const acceptsImages = constraints.modelType === "image-to-video";
  const mode = {
    ...modeCapabilitiesFromConstraints(constraints),
    // `audio_url` plus up to 10 `reference_audio_urls` when the model takes audio.
    maxInputAudios: constraints.audioInput ? 10 : 0,
  };
  return {
    generate: mode,
    imageToVideo: {
      ...mode,
      enabled: acceptsImages,
      // Reference models take up to 30 `reference_image_urls`; image-to-video
      // models take one `image_url` plus an optional `end_image_url`.
      maxInputImages: acceptsImages ? (isReferenceModel ? 30 : 2) : 0,
    },
    videoToVideo: {
      ...mode,
      enabled: constraints.videoInput,
      // `video_url` plus up to 10 `reference_video_urls`; reference models may
      // also mix images in, which core routes through videoToVideo.
      maxInputVideos: constraints.videoInput ? (isReferenceModel ? 10 : 1) : 0,
      maxInputImages: isReferenceModel ? 30 : 0,
    },
  };
}

// Core resolves capabilities for the configured model before the provider can
// swap it, so the text default must advertise its image sibling's image mode or
// image requests are skipped before `resolveVeniceVideoModel` ever runs.
async function resolveVeniceModelCapabilities(
  model: string,
): Promise<VideoGenerationProviderCapabilities | undefined> {
  const constraints = await fetchVeniceVideoConstraints(model);
  if (!constraints) {
    return undefined;
  }
  const capabilities = capabilitiesFromVeniceVideoConstraints(model, constraints);
  if (model !== DEFAULT_TEXT_TO_VIDEO_MODEL) {
    return capabilities;
  }
  const sibling = await fetchVeniceVideoConstraints(DEFAULT_IMAGE_TO_VIDEO_MODEL);
  if (!sibling) {
    return capabilities;
  }
  return {
    ...capabilities,
    imageToVideo: capabilitiesFromVeniceVideoConstraints(DEFAULT_IMAGE_TO_VIDEO_MODEL, sibling)
      .imageToVideo,
  };
}

function resolveVeniceVideoModel(req: VideoGenerationRequest): string {
  const model = normalizeOptionalString(req.model) ?? DEFAULT_TEXT_TO_VIDEO_MODEL;
  const hasImageInput = (req.inputImages?.length ?? 0) > 0;
  return model === DEFAULT_TEXT_TO_VIDEO_MODEL && hasImageInput
    ? DEFAULT_IMAGE_TO_VIDEO_MODEL
    : model;
}

function resolveAssetUrl(asset: VideoGenerationSourceAsset, defaultMimeType: string): string {
  const url = normalizeOptionalString(asset.url);
  if (url) {
    return url;
  }
  if (!asset.buffer) {
    throw new Error("venice video reference input is missing media data");
  }
  const mimeType = normalizeOptionalString(asset.mimeType) ?? defaultMimeType;
  return `data:${mimeType};base64,${asset.buffer.toString("base64")}`;
}

function assetRole(asset: VideoGenerationSourceAsset): string | undefined {
  return normalizeOptionalString(asset.role)?.toLowerCase();
}

type VeniceMediaKeys = {
  single: string;
  references: string;
  referenceRole: string;
  defaultMimeType: string;
  end?: { role: string; key: string };
};

// First unlabeled asset fills the single slot; labeled references and any
// overflow go to the list field. Images additionally map `last_frame`.
function applyMediaInputs(
  body: Record<string, unknown>,
  assets: VideoGenerationSourceAsset[],
  keys: VeniceMediaKeys,
) {
  const references: string[] = [];
  for (const asset of assets) {
    const url = resolveAssetUrl(asset, keys.defaultMimeType);
    const role = assetRole(asset);
    if (keys.end && role === keys.end.role) {
      body[keys.end.key] = url;
    } else if (role === keys.referenceRole || body[keys.single] !== undefined) {
      references.push(url);
    } else {
      body[keys.single] = url;
    }
  }
  if (references.length > 0) {
    body[keys.references] = references;
  }
}

export function buildVeniceVideoRequestBody(
  req: VideoGenerationRequest,
  model: string,
): Record<string, unknown> {
  const durationSeconds =
    typeof req.durationSeconds === "number" && Number.isFinite(req.durationSeconds)
      ? Math.max(1, Math.round(req.durationSeconds))
      : DEFAULT_DURATION_SECONDS;
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    // Venice requires `duration` as a `<n>s` string; core passes seconds.
    duration: `${durationSeconds}s`,
  };
  const aspectRatio = normalizeOptionalString(req.aspectRatio);
  if (aspectRatio) {
    body.aspect_ratio = aspectRatio;
  }
  const resolution = normalizeOptionalString(req.resolution);
  if (resolution) {
    body.resolution = resolution.toLowerCase();
  }
  if (typeof req.audio === "boolean") {
    body.audio = req.audio;
  }
  applyMediaInputs(body, req.inputImages ?? [], {
    single: "image_url",
    references: "reference_image_urls",
    referenceRole: "reference_image",
    defaultMimeType: "image/png",
    end: { role: "last_frame", key: "end_image_url" },
  });
  applyMediaInputs(body, req.inputVideos ?? [], {
    single: "video_url",
    references: "reference_video_urls",
    referenceRole: "reference_video",
    defaultMimeType: "video/mp4",
  });
  applyMediaInputs(body, req.inputAudios ?? [], {
    single: "audio_url",
    references: "reference_audio_urls",
    referenceRole: "reference_audio",
    defaultMimeType: "audio/mpeg",
  });
  return body;
}

function resolveGeneratedVideoMaxBytes(req: VideoGenerationRequest): number {
  const configured = req.cfg.agents?.defaults?.mediaMaxMb;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * 1024 * 1024);
  }
  return DEFAULT_GENERATED_VIDEO_MAX_BYTES;
}

type VeniceVideoHttp = {
  headers: Record<string, string>;
  deadline: ProviderOperationDeadline;
};

async function postVeniceJson(
  path: string,
  body: Record<string, unknown>,
  http: VeniceVideoHttp,
  auditContext: string,
) {
  return await veniceVideoFetchGuard({
    url: `${VENICE_BASE_URL}${path}`,
    init: { method: "POST", headers: http.headers, body: JSON.stringify(body) },
    timeoutMs: resolveProviderOperationTimeoutMs({
      deadline: http.deadline,
      defaultTimeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    }),
    policy: { allowedHostnames: VENICE_ALLOWED_HOSTNAMES },
    auditContext,
  });
}

async function readVeniceJson(response: Response, errorContext: string): Promise<unknown> {
  try {
    return await readProviderJsonResponse<unknown>(response, errorContext);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(": malformed JSON response")) {
      throw new Error(VENICE_VIDEO_MALFORMED_RESPONSE, { cause: error });
    }
    throw error;
  }
}

// The quote is advisory metadata; no quote failure may block generation.
async function quoteVeniceVideo(
  body: Record<string, unknown>,
  http: VeniceVideoHttp,
): Promise<number | undefined> {
  const quoteBody: Record<string, unknown> = { model: body.model, duration: body.duration };
  for (const key of ["aspect_ratio", "resolution", "audio"]) {
    if (body[key] !== undefined) {
      quoteBody[key] = body[key];
    }
  }
  try {
    const { response, release } = await postVeniceJson(
      "/video/quote",
      quoteBody,
      http,
      "venice-video-quote",
    );
    try {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const payload = await readVeniceJson(response, "venice video quote failed");
      return isRecord(payload) && typeof payload.quote === "number" ? payload.quote : undefined;
    } finally {
      await release();
    }
  } catch {
    return undefined;
  }
}

async function queueVeniceVideo(
  body: Record<string, unknown>,
  http: VeniceVideoHttp,
): Promise<{ queueId: string; downloadUrl?: string }> {
  const { response, release } = await postVeniceJson(
    "/video/queue",
    body,
    http,
    "venice-video-queue",
  );
  try {
    await assertOkOrThrowHttpError(response, "venice video generation failed");
    const payload = await readVeniceJson(response, "venice video queue failed");
    const queueId = isRecord(payload) ? normalizeOptionalString(payload.queue_id) : undefined;
    if (!queueId) {
      throw new Error(VENICE_VIDEO_MALFORMED_RESPONSE);
    }
    const downloadUrl = isRecord(payload)
      ? normalizeOptionalString(payload.download_url)
      : undefined;
    return { queueId, ...(downloadUrl ? { downloadUrl } : {}) };
  } finally {
    await release();
  }
}

function responseMimeType(response: Response): string {
  return (
    normalizeOptionalString(response.headers.get("content-type")?.split(";")[0]) ?? "video/mp4"
  );
}

async function readVideoBytes(response: Response, maxBytes: number): Promise<GeneratedVideoAsset> {
  const mimeType = responseMimeType(response);
  const buffer = await readResponseWithLimit(response, maxBytes, {
    onOverflow: ({ maxBytes: limit }) => new Error(`venice generated video exceeds ${limit} bytes`),
  });
  return { buffer, mimeType, fileName: `video-1.${extensionForMime(mimeType)?.slice(1) ?? "mp4"}` };
}

async function downloadVeniceVideo(
  url: string,
  http: VeniceVideoHttp,
  maxBytes: number,
): Promise<GeneratedVideoAsset> {
  const { response, release } = await veniceVideoFetchGuard({
    url,
    timeoutMs: resolveProviderOperationTimeoutMs({
      deadline: http.deadline,
      defaultTimeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    }),
    auditContext: "venice-video-download",
  });
  try {
    await assertOkOrThrowHttpError(response, "venice generated video download failed");
    return await readVideoBytes(response, maxBytes);
  } finally {
    await release();
  }
}

// Venice's retrieve endpoint answers JSON `{status: "PROCESSING"}` while the job
// runs and the raw video bytes once done. Private models return JSON
// `COMPLETED` and hand the bytes out through the queue-time `download_url`.
async function retrieveVeniceVideo(params: {
  model: string;
  queueId: string;
  downloadUrl?: string;
  http: VeniceVideoHttp;
  maxBytes: number;
}): Promise<GeneratedVideoAsset> {
  for (;;) {
    const { response, release } = await postVeniceJson(
      "/video/retrieve",
      { model: params.model, queue_id: params.queueId, delete_media_on_completion: true },
      params.http,
      "venice-video-retrieve",
    );
    try {
      await assertOkOrThrowHttpError(response, "venice video status request failed");
      if (responseMimeType(response).startsWith("video/")) {
        return await readVideoBytes(response, params.maxBytes);
      }
      const payload = await readVeniceJson(response, "venice video status request failed");
      const status = isRecord(payload) ? normalizeOptionalString(payload.status) : undefined;
      if (!status) {
        throw new Error(VENICE_VIDEO_MALFORMED_RESPONSE);
      }
      if (status.toUpperCase() === "COMPLETED") {
        if (!params.downloadUrl) {
          throw new Error(VENICE_VIDEO_MALFORMED_RESPONSE);
        }
        return await downloadVeniceVideo(params.downloadUrl, params.http, params.maxBytes);
      }
      if (status.toUpperCase() !== "PROCESSING") {
        // Venice documents only PROCESSING/COMPLETED; anything else is a
        // provider-signaled terminal state, so surface it instead of "malformed".
        const detail = isRecord(payload) ? normalizeOptionalString(payload.error) : undefined;
        throw new Error(
          `venice video generation ${status.toLowerCase()}${detail ? `: ${detail}` : ""}`,
        );
      }
    } finally {
      await release();
    }
    await waitProviderOperationPollInterval({
      deadline: params.http.deadline,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  }
}

export function buildVeniceVideoGenerationProvider(): VideoGenerationProvider {
  return {
    id: PROVIDER_ID,
    label: "Venice",
    defaultModel: DEFAULT_TEXT_TO_VIDEO_MODEL,
    defaultTimeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    models: [...VENICE_VIDEO_MODELS],
    isConfigured: ({ agentDir }) => isProviderApiKeyConfigured({ provider: PROVIDER_ID, agentDir }),
    capabilities: {
      generate: {
        maxVideos: 1,
        maxDurationSeconds: 30,
        maxInputAudios: 1,
        aspectRatios: [...VENICE_VIDEO_ASPECT_RATIOS],
        resolutions: [...VENICE_VIDEO_RESOLUTIONS],
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsAudio: true,
      },
      imageToVideo: {
        enabled: true,
        maxVideos: 1,
        maxInputImages: 2,
        maxInputAudios: 1,
        maxDurationSeconds: 30,
        aspectRatios: [...VENICE_VIDEO_ASPECT_RATIOS],
        resolutions: [...VENICE_VIDEO_RESOLUTIONS],
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsAudio: true,
      },
      videoToVideo: {
        enabled: true,
        maxVideos: 1,
        maxInputVideos: 1,
        maxInputAudios: 1,
        supportsAspectRatio: false,
        supportsResolution: true,
        supportsAudio: false,
      },
    },
    resolveModelCapabilities: ({ model }) => resolveVeniceModelCapabilities(model),
    async generateVideo(req) {
      const model = resolveVeniceVideoModel(req);
      const body = buildVeniceVideoRequestBody(req, model);
      const auth = await resolveApiKeyForProvider({
        provider: PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("venice API key missing");
      }
      const http: VeniceVideoHttp = {
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
        deadline: createProviderOperationDeadline({
          timeoutMs: resolvePositiveTimerTimeoutMs(req.timeoutMs, DEFAULT_OPERATION_TIMEOUT_MS),
          label: "venice video generation",
        }),
      };
      const quoteUsd = await quoteVeniceVideo(body, http);
      const { queueId, downloadUrl } = await queueVeniceVideo(body, http);
      const video = await retrieveVeniceVideo({
        model,
        queueId,
        downloadUrl,
        http,
        maxBytes: resolveGeneratedVideoMaxBytes(req),
      });
      return {
        videos: [video],
        model,
        metadata: {
          queueId,
          ...(quoteUsd !== undefined ? { quoteUsd } : {}),
        },
      };
    },
  };
}
