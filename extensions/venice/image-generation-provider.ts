import type {
  GeneratedImageAsset,
  ImageGenerationOutputFormat,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerationSourceImage,
} from "openclaw/plugin-sdk/image-generation";
import {
  generatedImageAssetFromBase64,
  sniffImageMimeType,
} from "openclaw/plugin-sdk/image-generation";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import { assertOkOrThrowHttpError } from "openclaw/plugin-sdk/provider-http";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { VENICE_ALLOWED_HOSTNAMES, VENICE_BASE_URL } from "./models.js";

const PROVIDER_ID = "venice";
// Venice's native default text-to-image model (model_spec trait "eliza-default").
const DEFAULT_VENICE_IMAGE_MODEL = "venice-sd35";
// Venice's documented /image/edit default. Edit models are a separate id family
// (`*-edit`), so a generation model id cannot be reused for an edit request.
const DEFAULT_VENICE_EDIT_MODEL = "firered-image-edit";
const VENICE_EDIT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_OUTPUT_FORMAT: ImageGenerationOutputFormat = "png";
// Venice caps pixel-addressed models at 1280px per edge.
const VENICE_MAX_EDGE = 1280;
const VENICE_IMAGE_MALFORMED_RESPONSE = "venice image generation response malformed";

// Advisory hint list for callers; any Venice image model id is accepted.
const VENICE_IMAGE_MODELS = [
  "venice-sd35",
  "flux-2-pro",
  "flux-2-max",
  "seedream-v5-lite",
  "nano-banana-pro",
  "qwen-image-2",
  "hunyuan-image-v3",
  "lustify-v8",
  "lustify-sdxl",
];
const VENICE_EDIT_MODELS = [
  "firered-image-edit",
  "qwen-edit-uncensored",
  "qwen-image-3-edit",
  "seedream-v5-lite-edit",
  "nano-banana-pro-edit",
  "flux-2-max-edit",
  "gpt-image-2-edit",
];
const VENICE_SUPPORTED_SIZES = ["1024x1024", "1280x720", "720x1280", "1280x768", "768x1280"];
const VENICE_SUPPORTED_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "16:9", "9:16", "21:9", "3:4", "4:5"];
const VENICE_OUTPUT_FORMATS: ImageGenerationOutputFormat[] = ["png", "jpeg", "webp"];

let veniceImageFetchGuard = fetchWithSsrFGuard;

export function setVeniceImageFetchGuardForTesting(impl: typeof fetchWithSsrFGuard | null): void {
  veniceImageFetchGuard = impl ?? fetchWithSsrFGuard;
}

function clampEdge(value: number): number {
  return Math.max(1, Math.min(VENICE_MAX_EDGE, Math.floor(value)));
}

function parseSize(raw: string | undefined): { width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/iu.exec(raw?.trim() ?? "");
  if (!match) {
    return null;
  }
  const width = Number.parseInt(match[1] ?? "", 10);
  const height = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width: clampEdge(width), height: clampEdge(height) };
}

// Venice models accept either width/height (pixel models) OR aspect_ratio,
// optionally with a resolution tier. Send the most specific signal the caller
// gave and let Venice apply each model's own defaults for the rest.
function applyGeometry(
  body: Record<string, unknown>,
  req: { size?: string; aspectRatio?: string; resolution?: string },
): void {
  const size = parseSize(req.size);
  if (size) {
    body.width = size.width;
    body.height = size.height;
    return;
  }
  if (req.aspectRatio?.trim()) {
    body.aspect_ratio = req.aspectRatio.trim();
  }
  if (req.resolution) {
    body.resolution = req.resolution;
  }
}

function parseVeniceImageResponse(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.images)) {
    throw new Error(VENICE_IMAGE_MALFORMED_RESPONSE);
  }
  const images: string[] = [];
  for (const entry of payload.images) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(VENICE_IMAGE_MALFORMED_RESPONSE);
    }
    images.push(entry);
  }
  return images;
}

function resolveVeniceEditModel(requested: string | undefined): string {
  const model = requested?.trim();
  // Core forwards the configured generation model (default or user-picked) on
  // edit requests. Venice edit models are a separate id family, every one of
  // which carries "edit" in its id, so anything else routes to the edit default.
  return model && model.includes("edit") ? model : DEFAULT_VENICE_EDIT_MODEL;
}

async function editVeniceImage(
  req: ImageGenerationRequest,
  inputImage: ImageGenerationSourceImage,
  apiKey: string,
): Promise<ImageGenerationResult> {
  const model = resolveVeniceEditModel(req.model);
  const format = req.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const requestBody: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    image: inputImage.buffer.toString("base64"),
    output_format: format,
    safe_mode: false,
  };
  if (req.aspectRatio?.trim()) {
    requestBody.aspect_ratio = req.aspectRatio.trim();
  }
  if (req.resolution) {
    requestBody.resolution = req.resolution;
  }
  const { response, release } = await veniceImageFetchGuard({
    url: `${VENICE_BASE_URL}/image/edit`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs: req.timeoutMs,
    policy: { allowedHostnames: VENICE_ALLOWED_HOSTNAMES },
    auditContext: "venice-image-edit",
  });
  try {
    await assertOkOrThrowHttpError(response, "venice image edit failed");
    // /image/edit answers with the raw image bytes, not the base64 JSON that
    // /image/generate uses.
    const buffer = await readResponseWithLimit(response, VENICE_EDIT_MAX_BYTES, {
      onOverflow: ({ maxBytes }) =>
        new Error(`venice image edit response exceeds ${maxBytes} bytes`),
    });
    if (buffer.length === 0) {
      throw new Error("venice image edit response missing image data");
    }
    const headerMimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const detected = sniffImageMimeType(buffer, headerMimeType || `image/${format}`);
    return {
      images: [{ buffer, mimeType: detected.mimeType, fileName: `image-1.${detected.extension}` }],
      model,
    };
  } finally {
    await release();
  }
}

export function buildVeniceImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    label: "Venice",
    defaultModel: DEFAULT_VENICE_IMAGE_MODEL,
    models: [...VENICE_IMAGE_MODELS, ...VENICE_EDIT_MODELS],
    isConfigured: ({ agentDir }) => isProviderApiKeyConfigured({ provider: PROVIDER_ID, agentDir }),
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxInputImages: 1,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      geometry: {
        sizes: [...VENICE_SUPPORTED_SIZES],
        aspectRatios: [...VENICE_SUPPORTED_ASPECT_RATIOS],
        resolutions: ["1K", "2K", "4K"],
      },
      output: {
        formats: [...VENICE_OUTPUT_FORMATS],
      },
    },
    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("venice API key missing");
      }

      const inputImage = req.inputImages?.[0];
      if (inputImage) {
        return await editVeniceImage(req, inputImage, auth.apiKey);
      }

      const model = req.model?.trim() || DEFAULT_VENICE_IMAGE_MODEL;
      const format = req.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
      const requestBody: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        format,
        return_binary: false,
        // The Venice plugin exists to serve uncensored models; Venice's own
        // safe_mode default (true) would filter exactly those outputs.
        safe_mode: false,
        variants: Math.max(1, Math.min(4, req.count ?? 1)),
      };
      applyGeometry(requestBody, req);

      const { response, release } = await veniceImageFetchGuard({
        url: `${VENICE_BASE_URL}/image/generate`,
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
        timeoutMs: req.timeoutMs,
        policy: { allowedHostnames: VENICE_ALLOWED_HOSTNAMES },
        auditContext: "venice-image-generate",
      });
      try {
        await assertOkOrThrowHttpError(response, "venice image generation failed");
        const base64Images = parseVeniceImageResponse(await response.json());
        const images: GeneratedImageAsset[] = [];
        base64Images.forEach((base64, index) => {
          const asset = generatedImageAssetFromBase64({
            base64,
            index,
            defaultMimeType: `image/${format === "jpeg" ? "jpeg" : format}`,
            sniffMimeType: true,
          });
          if (asset) {
            images.push(asset);
          }
        });
        if (images.length === 0) {
          throw new Error("venice image generation response missing image data");
        }
        return { images, model };
      } finally {
        await release();
      }
    },
  };
}
