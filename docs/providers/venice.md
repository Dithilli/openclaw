---
summary: "Use Venice AI privacy-focused models in OpenClaw"
read_when:
  - You want privacy-focused inference in OpenClaw
  - You want Venice AI setup guidance
title: "Venice AI"
---

Venice AI provides **privacy-focused AI inference** with support for uncensored models and access to major proprietary models through their anonymized proxy. All inference is private by default — no training on your data, no logging.

## Why Venice in OpenClaw

- **Private inference** for open-source models (no logging).
- **Uncensored models** when you need them.
- **Anonymized access** to proprietary models (Opus/GPT/Gemini) when quality matters.
- OpenAI-compatible `/v1` endpoints.

## Privacy modes

Venice offers two privacy levels — understanding this is key to choosing your model:

| Mode           | Description                                                                                                                       | Models                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Private**    | Fully private. Prompts/responses are **never stored or logged**. Ephemeral.                                                       | Llama, Qwen, DeepSeek, Kimi, MiniMax, Venice Uncensored, etc. |
| **Anonymized** | Proxied through Venice with metadata stripped. The underlying provider (OpenAI, Anthropic, Google, xAI) sees anonymized requests. | Claude, GPT, Gemini, Grok                                     |

<Warning>
Anonymized models are **not** fully private. Venice strips metadata before forwarding, but the underlying provider (OpenAI, Anthropic, Google, xAI) still processes the request. Choose **Private** models when full privacy is required.
</Warning>

## Features

- **Privacy-focused**: Choose between "private" (fully private) and "anonymized" (proxied) modes
- **Uncensored models**: Access to models without content restrictions
- **Major model access**: Use Claude, GPT, Gemini, and Grok via Venice's anonymized proxy
- **OpenAI-compatible API**: Standard `/v1` endpoints for easy integration
- **Streaming**: Supported on all models
- **Function calling**: Supported on select models (check model capabilities)
- **Vision**: Supported on models with vision capability
- **No hard rate limits**: Fair-use throttling may apply for extreme usage

## Getting started

<Steps>
  <Step title="Install the plugin">
    ```bash
    openclaw plugins install @openclaw/venice-provider
    ```
  </Step>
  <Step title="Get your API key">
    1. Sign up at [venice.ai](https://venice.ai)
    2. Go to **Settings > API Keys > Create new key**
    3. Copy your API key (format: `vapi_xxxxxxxxxxxx`)
  </Step>
  <Step title="Configure OpenClaw">
    Choose your preferred setup method:

    <Tabs>
      <Tab title="Interactive (recommended)">
        ```bash
        openclaw onboard --auth-choice venice-api-key
        ```

        This will:
        1. Prompt for your API key (or use existing `VENICE_API_KEY`)
        2. Show all available Venice models
        3. Let you pick your default model
        4. Configure the provider automatically
      </Tab>
      <Tab title="Environment variable">
        ```bash
        export VENICE_API_KEY="vapi_xxxxxxxxxxxx"
        ```
      </Tab>
      <Tab title="Non-interactive">
        ```bash
        openclaw onboard --non-interactive \
          --auth-choice venice-api-key \
          --venice-api-key "vapi_xxxxxxxxxxxx"
        ```
      </Tab>
    </Tabs>

  </Step>
  <Step title="Verify setup">
    ```bash
    openclaw agent --model venice/kimi-k2-5 --message "Hello, are you working?"
    ```
  </Step>
</Steps>

## Model selection

After setup, OpenClaw shows all available Venice models. Pick based on your needs:

- **Default model**: `venice/kimi-k2-5` for strong private reasoning plus vision.
- **High-capability option**: `venice/claude-opus-4-8` for the strongest anonymized Venice path.
- **Privacy**: Choose "private" models for fully private inference.
- **Capability**: Choose "anonymized" models to access Claude, GPT, Gemini via Venice's proxy.

Change your default model anytime:

```bash
openclaw models set venice/kimi-k2-5
openclaw models set venice/claude-opus-4-8
```

List all available models:

```bash
openclaw models list --all --provider venice
```

You can also run `openclaw configure`, select **Model/auth**, and choose **Venice AI**.

<Tip>
Use the table below to pick the right model for your use case.

| Use Case                   | Recommended Model                      | Why                                          |
| -------------------------- | -------------------------------------- | -------------------------------------------- |
| **General chat (default)** | `kimi-k2-5`                            | Strong private reasoning plus vision         |
| **Best overall quality**   | `claude-opus-4-8`                      | Strongest anonymized Venice option           |
| **Privacy + coding**       | `qwen3-coder-480b-a35b-instruct-turbo` | Private coding model with large context      |
| **Private vision**         | `kimi-k2-5`                            | Vision support without leaving private mode  |
| **Fast + cheap**           | `qwen3-5-9b`                           | Lightweight reasoning model                  |
| **Complex private tasks**  | `deepseek-v3.2`                        | Strong reasoning, but no Venice tool support |
| **Uncensored**             | `venice-uncensored-1-2`                | No content restrictions                      |

</Tip>

## DeepSeek V4 replay behavior

If Venice exposes DeepSeek V4 models such as `venice/deepseek-v4-pro` or
`venice/deepseek-v4-flash`, OpenClaw fills the required DeepSeek V4
`reasoning_content` replay placeholder on assistant messages when the proxy
omits it. Venice rejects DeepSeek's native top-level `thinking` control, so
OpenClaw keeps that provider-specific replay fix separate from the native
DeepSeek provider's thinking controls.

## Image generation

Venice image models are available through the `image_generate` tool — the same
tool used for every other image provider. Once `VENICE_API_KEY` is set, OpenClaw
registers Venice as an image-generation provider automatically; no extra
configuration is needed.

- **Default model**: `venice-sd35`. Override with any Venice image model, for
  example `flux-2-pro`, `seedream-v5-lite`, `nano-banana-pro`, or the uncensored
  `lustify-v8`.
- **Geometry**: pass `size` (width/height up to 1280px), `aspectRatio`, or
  `resolution` (`1K`/`2K`/`4K`) — Venice applies each model's own defaults for
  anything you omit.
- **Uncensored by default**: Venice's `safe_mode` is disabled for this provider
  so uncensored image models behave as intended.
- **Editing**: pass one reference image and OpenClaw calls Venice's
  `/image/edit` endpoint. The default edit model is `firered-image-edit`;
  override with any Venice `*-edit` model such as `qwen-edit-uncensored`,
  `seedream-v5-lite-edit`, or `nano-banana-pro-edit`.

List the registered image providers and models at runtime with the tool's
`list` action:

```text
/tool image_generate action=list
```

See [Image generation](/tools/image-generation) for the full tool reference.

## Video generation

Venice video models are available through the `video_generate` tool. Once
`VENICE_API_KEY` is set, OpenClaw registers Venice as a video-generation
provider automatically.

- **Default model**: `wan-3-0-text-to-video` for text prompts. When you attach
  an image and leave `model` unset, OpenClaw switches to the
  `wan-3-0-image-to-video` sibling. Venice encodes the input mode in the model
  id (`*-text-to-video`, `*-image-to-video`, `*-reference-to-video`,
  `*-video-to-video`), so pick the id that matches your inputs when overriding.
- **Inputs**: a plain or `first_frame` image becomes the start frame, a
  `last_frame` image becomes the end frame, and `reference_image` images are
  sent as references (up to 30 on reference-to-video models). Video and audio
  references map to Venice's `video_url`, `reference_video_urls`, `audio_url`,
  and `reference_audio_urls`.
- **Controls**: `durationSeconds` (sent as Venice's `Ns` string, default 5s),
  `aspectRatio`, `resolution`, and `audio`. Per-model limits come from Venice's
  live `/models?type=video` constraints, so unsupported values are normalized
  or rejected before the job is queued.
- **Flow**: OpenClaw asks `/video/quote` for a price, queues on `/video/queue`,
  polls `/video/retrieve` until the mp4 is ready, and deletes the media from
  Venice once downloaded. The USD quote is returned in the result metadata as
  `quoteUsd`.
- **Consent-gated models**: some Seedance models require Venice's one-time
  consent flow; Venice answers `409` until you accept it in your Venice
  account. Pick another model or complete the consent there.

See [Video generation](/tools/video-generation) for the full tool reference.

## Built-in catalog (123 total)

<AccordionGroup>
  <Accordion title="Private models (69) - fully private, no logging">
    | Model ID | Name | Context | Features |
    | --- | --- | --- | --- |
    | `zai-org-glm-5-2` | GLM 5.2 | 1M | Reasoning, coding |
    | `zai-org-glm-5-1` | GLM 5.1 | 200k | Reasoning |
    | `zai-org-glm-5` | GLM 5 | 198k | Reasoning, coding |
    | `olafangensan-glm-4.7-flash-heretic` | GLM 4.7 Flash Heretic | 200k | Reasoning, uncensored |
    | `zai-org-glm-4.7-flash` | GLM 4.7 Flash | 128k | Reasoning |
    | `zai-org-glm-4.6` | GLM 4.6 | 198k | Reasoning |
    | `zai-org-glm-4.7` | GLM 4.7 | 198k | Reasoning |
    | `venice-uncensored-1-2` | Venice Uncensored 1.2 | 128k | Vision, uncensored |
    | `venice-uncensored-role-play` | Venice Role Play Uncensored | 128k | Vision, uncensored |
    | `qwen3-6-27b` | Qwen 3.6 27B | 256k | Reasoning, vision, coding |
    | `qwen3-5-9b` | Qwen 3.5 9B | 256k | Reasoning, vision |
    | `qwen3-5-35b-a3b` | Qwen3.5 35B A3B | 256k | Reasoning, vision, coding |
    | `qwen3-235b-a22b-thinking-2507` | Qwen3 235B Thinking | 128k | Reasoning |
    | `qwen3-235b-a22b-instruct-2507` | Qwen3 235B Instruct | 128k | General |
    | `qwen3-next-80b` | Qwen3 Next 80B | 256k | General |
    | `qwen3-vl-235b-a22b` | Qwen3 VL 235B (Vision) | 128k | Vision |
    | `qwen3-coder-480b-a35b-instruct-turbo` | Qwen3 Coder 480B Turbo | 256k | Coding |
    | `google-gemma-4-26b-a4b-it` | Google Gemma 4 26B A4B Instruct | 256k | Reasoning, vision |
    | `google-gemma-4-31b-it` | Google Gemma 4 31B Instruct | 256k | Reasoning, vision |
    | `gemma-4-uncensored` | Gemma 4 Uncensored | 256k | Vision, uncensored |
    | `google-gemma-3-27b-it` | Google Gemma 3 27B Instruct | 198k | Vision |
    | `grok-4-3` | Grok 4.3 | 1M | Reasoning, vision |
    | `grok-4-20` | Grok 4.20 | 2M | Reasoning, vision |
    | `grok-4-20-multi-agent` | Grok 4.20 Multi-Agent | 2M | Reasoning, vision, tools disabled |
    | `grok-build-0-1` | Grok Build 0.1 | 256k | Reasoning, vision, coding |
    | `mistral-small-3-2-24b-instruct` | Mistral Small 3.2 24B Instruct | 256k | Vision |
    | `hermes-3-llama-3.1-405b` | Hermes 3 Llama 3.1 405B | 128k | Tools disabled |
    | `openai-gpt-oss-120b` | OpenAI GPT OSS 120B | 128k | Reasoning |
    | `kimi-k2-6` | Kimi K2.6 | 256k | Reasoning, vision, coding |
    | `kimi-k2-7-code` | Kimi K2.7 Code | 256k | Reasoning, vision, coding |
    | `kimi-k2-5` | Kimi K2.5 | 256k | Default, reasoning, vision, coding |
    | `xiaomi-mimo-v2-5` | MiMo-V2.5 | 1M | Reasoning, vision, coding |
    | `deepseek-v4-pro` | DeepSeek V4 Pro | 1M | Reasoning, coding |
    | `deepseek-v4-flash` | DeepSeek V4 Flash | 1M | Reasoning, coding |
    | `deepseek-v3.2` | DeepSeek V3.2 | 160k | Reasoning |
    | `llama-3.2-3b` | Llama 3.2 3B | 128k | General |
    | `llama-3.3-70b` | Llama 3.3 70B | 128k | General |
    | `minimax-m3-preview` | MiniMax M3 Preview | 524k | Reasoning, vision, coding |
    | `minimax-m25` | MiniMax M2.5 | 198k | Reasoning, coding |
    | `minimax-m27` | MiniMax M2.7 | 198k | Reasoning, coding |
    | `nvidia-nemotron-3-nano-30b-a3b` | NVIDIA Nemotron 3 Nano 30B | 128k | General |
    | `nvidia-nemotron-3-ultra-550b-a55b` | NVIDIA Nemotron 3 Ultra | 256k | Reasoning |
    | `deepseek-v4-1-flash` | DeepSeek V4.1 Flash | 1M | Reasoning, vision, coding |
    | `deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | 1M | Reasoning, coding |
    | `deepseek-v4-flash-0731-fast` | DeepSeek V4 Flash 0731 Fast | 1M | Reasoning, coding |
    | `deepseek-v4-pro-0813` | DeepSeek V4 Pro 0813 | 1M | Reasoning, coding |
    | `e2ee-deepseek-v4-flash` | DeepSeek V4 Flash | 1M | Reasoning, coding |
    | `e2ee-gemma-4-26b-a4b-uncensored-p` | Gemma 4 26B A4B Uncensored | 64k | Uncensored, tools disabled |
    | `e2ee-glm-5-2-p` | GLM 5.2 | 524k | Reasoning, coding |
    | `e2ee-glm-5-3-flash` | GLM 5.3 Flash | 1M | Reasoning, vision, coding |
    | `e2ee-glm-5-3-p` | GLM 5.3 | 1M | Reasoning, coding |
    | `e2ee-gpt-oss-120b-p` | GPT OSS 120B | 128k | Reasoning, tools disabled |
    | `e2ee-kimi-k2-6` | Kimi K2.6 | 262k | Reasoning, vision, coding |
    | `e2ee-kimi-k3-p` | Kimi K3 | 1M | Reasoning, vision, coding |
    | `e2ee-qwen-2-5-7b-p` | Qwen 2.5 7B | 32k | Tools disabled |
    | `e2ee-qwen3-6-35b-a3b` | Qwen 3.6 35B A3B FP8 | 32k | Reasoning, coding |
    | `e2ee-qwen3-8-27b` | Qwen 3.8 27B | 262k | Reasoning, vision, coding |
    | `e2ee-qwen3-vl-30b-a3b-p` | Qwen3 VL 30B A3B | 128k | Vision |
    | `grok-4-5` | Grok 4.5 | 500k | Reasoning, vision, coding |
    | `grok-4-6` | Grok 4.6 | 500k | Reasoning, vision, coding |
    | `grok-4-7` | Grok 4.7 | 500k | Reasoning, vision, coding |
    | `inkling` | Inkling | 524k | Reasoning, vision, coding |
    | `kimi-k3` | Kimi K3 | 1M | Reasoning, vision, coding |
    | `kimi-k3-fast-api` | Kimi K3 Fast | 1M | Reasoning, vision, coding |
    | `qwen-3-8-2-4t-a95b` | Qwen 3.8 2.4T | 262k | Reasoning, coding |
    | `qwen-3-8-27b` | Qwen 3.8 27B | 262k | Reasoning, vision, coding, uncensored |
    | `qwen3-6-35b-a3b` | Qwen 3.6 35B A3B | 256k | Reasoning, vision, coding |
    | `z-ai-glm-5-3` | GLM 5.3 | 1M | Reasoning, coding |
    | `z-ai-glm-5-3-flash` | GLM 5.3 Flash | 1.05M | Reasoning, vision, coding |
  </Accordion>
  <Accordion title="Anonymized models (54) - via Venice proxy">
    | Model ID | Name | Context | Features |
    | --- | --- | --- | --- |
    | `z-ai-glm-5-turbo` | GLM 5 Turbo | 200k | Reasoning, coding |
    | `z-ai-glm-5v-turbo` | GLM 5V Turbo | 200k | Reasoning, vision, coding |
    | `qwen-3-7-max` | Qwen 3.7 Max | 1M | Reasoning, vision, coding |
    | `qwen-3-7-plus` | Qwen 3.7 Plus | 1M | Reasoning, vision, coding |
    | `qwen-3-6-plus` | Qwen 3.6 Plus Uncensored | 1M | Reasoning, vision, coding, uncensored |
    | `qwen3-5-397b-a17b` | Qwen 3.5 397B | 128k | Reasoning, vision, coding |
    | `gemini-3-1-pro-preview` | Gemini 3.1 Pro (via Venice) | 1M | Reasoning, vision |
    | `gemini-3-5-flash` | Gemini 3.5 Flash | 1M | Reasoning, vision |
    | `gemini-3-flash-preview` | Gemini 3 Flash (via Venice) | 256k | Reasoning, vision |
    | `claude-fable-5` | Claude Fable 5 | 1M | Reasoning, vision, coding |
    | `claude-opus-4-8` | Claude Opus 4.8 | 1M | Reasoning, vision, coding |
    | `claude-opus-4-8-fast` | Claude Opus 4.8 Fast | 1M | Reasoning, vision, coding |
    | `claude-opus-4-7` | Claude Opus 4.7 | 1M | Reasoning, vision, coding |
    | `claude-opus-4-6` | Claude Opus 4.6 (via Venice) | 1M | Reasoning, vision, coding |
    | `claude-opus-4-5` | Claude Opus 4.5 | 198k | Reasoning, vision, coding |
    | `claude-sonnet-4-6` | Claude Sonnet 4.6 (via Venice) | 1M | Reasoning, vision, coding |
    | `claude-sonnet-4-5` | Claude Sonnet 4.5 | 198k | Reasoning, vision, coding |
    | `openai-gpt-52` | GPT-5.2 (via Venice) | 256k | Reasoning |
    | `openai-gpt-53-codex` | GPT-5.3 Codex (via Venice) | 400k | Reasoning, vision, coding |
    | `openai-gpt-54` | GPT-5.4 (via Venice) | 1M | Reasoning, vision |
    | `openai-gpt-54-pro` | GPT-5.4 Pro | 1M | Reasoning, vision |
    | `openai-gpt-54-mini` | GPT-5.4 Mini | 400k | Reasoning, vision |
    | `openai-gpt-55` | GPT-5.5 | 1M | Reasoning, vision |
    | `openai-gpt-55-pro` | GPT-5.5 Pro | 1M | Reasoning, vision |
    | `openai-gpt-4o-2024-11-20` | GPT-4o (via Venice) | 128k | Vision |
    | `openai-gpt-4o-mini-2024-07-18` | GPT-4o Mini (via Venice) | 128k | Vision |
    | `mercury-2` | Mercury 2 | 128k | Reasoning |
    | `aion-labs-aion-3-0` | Aion 3.0 | 128k | Reasoning, uncensored |
    | `aion-labs-aion-3-0-mini` | Aion 3.0 Mini | 128k | Reasoning, uncensored |
    | `aion-labs-aion-3-5` | Aion 3.5 | 262k | Reasoning, uncensored |
    | `aion-labs-aion-3-5-mini` | Aion 3.5 Mini | 262k | Reasoning, uncensored |
    | `claude-fable-5-1` | Claude Fable 5.1 | 1M | Reasoning, vision, coding |
    | `claude-opus-5` | Claude Opus 5 | 1M | Reasoning, vision, coding |
    | `claude-opus-5-5` | Claude Opus 5.5 | 1M | Reasoning, vision, coding |
    | `claude-opus-5-fast` | Claude Opus 5 Fast | 1M | Reasoning, vision, coding |
    | `claude-sonnet-5` | Claude Sonnet 5 | 1M | Reasoning, vision, coding |
    | `gemini-3-5-flash-lite` | Gemini 3.5 Flash-Lite | 1M | Reasoning, vision |
    | `gemini-3-6-flash` | Gemini 3.6 Flash | 1M | Reasoning, vision |
    | `gemini-3-7-flash` | Gemini 3.7 Flash | 1M | Reasoning, vision |
    | `gemini-3-8-flash` | Gemini 3.8 Flash | 1M | Reasoning, vision |
    | `mercury-2-5` | Mercury 2.5 | 260k | Reasoning |
    | `openai-gpt-56-luna` | GPT-5.6 Luna | 1M | Reasoning, vision |
    | `openai-gpt-56-luna-pro` | GPT-5.6 Luna Pro | 1M | Reasoning, vision |
    | `openai-gpt-56-sol` | GPT-5.6 Sol | 1M | Reasoning, vision |
    | `openai-gpt-56-sol-pro` | GPT-5.6 Sol Pro | 1M | Reasoning, vision |
    | `openai-gpt-56-terra` | GPT-5.6 Terra | 1M | Reasoning, vision |
    | `openai-gpt-56-terra-pro` | GPT-5.6 Terra Pro | 1M | Reasoning, vision |
    | `openai-gpt-6-astra` | GPT-6 Astra | 1.05M | Reasoning, vision |
    | `openai-gpt-6-astra-pro` | GPT-6 Astra Pro | 1.05M | Reasoning, vision |
    | `openai-gpt-6-luna` | GPT-6 Luna | 1.05M | Reasoning, vision |
    | `openai-gpt-6-sol` | GPT-6 Sol | 1.05M | Reasoning, vision |
    | `qwen-3-8-flash` | Qwen 3.8 Flash | 1M | Reasoning, vision, coding |
    | `qwen-3-8-max` | Qwen 3.8 Max | 1M | Reasoning, vision, coding |
    | `seed-2-1-turbo` | Seed 2.1 Turbo | 256k | Reasoning, vision, coding |
  </Accordion>
</AccordionGroup>

## Model discovery

OpenClaw ships a manifest-backed Venice seed catalog for read-only model listing. Runtime refresh can still discover models from the Venice API, and falls back to the manifest catalog if the API is unreachable.

The `/models` endpoint is public (no auth needed for listing), but inference requires a valid API key.

## Streaming and tool support

| Feature              | Support                                              |
| -------------------- | ---------------------------------------------------- |
| **Streaming**        | All models                                           |
| **Function calling** | Most models (check `supportsFunctionCalling` in API) |
| **Vision/Images**    | Models marked with "Vision" feature                  |
| **JSON mode**        | Supported via `response_format`                      |

## Pricing

Venice uses a credit-based system. Check [venice.ai/pricing](https://venice.ai/pricing) for current rates:

- **Private models**: Generally lower cost
- **Anonymized models**: Similar to direct API pricing + small Venice fee

### Venice (anonymized) vs direct API

| Aspect       | Venice (Anonymized)           | Direct API          |
| ------------ | ----------------------------- | ------------------- |
| **Privacy**  | Metadata stripped, anonymized | Your account linked |
| **Latency**  | +10-50ms (proxy)              | Direct              |
| **Features** | Most features supported       | Full features       |
| **Billing**  | Venice credits                | Provider billing    |

## Usage examples

```bash
# Use the default private model
openclaw agent --model venice/kimi-k2-5 --message "Quick health check"

# Use Claude Opus via Venice (anonymized)
openclaw agent --model venice/claude-opus-4-8 --message "Summarize this task"

# Use uncensored model
openclaw agent --model venice/venice-uncensored-1-2 --message "Draft options"

# Use vision model with image
openclaw agent --model venice/qwen3-vl-235b-a22b --message "Review attached image"

# Use coding model
openclaw agent --model venice/qwen3-coder-480b-a35b-instruct-turbo --message "Refactor this function"
```

## Troubleshooting

<AccordionGroup>
  <Accordion title="API key not recognized">
    ```bash
    echo $VENICE_API_KEY
    openclaw models list | grep venice
    ```

    Ensure the key starts with `vapi_`.

  </Accordion>

  <Accordion title="Model not available">
    The Venice model catalog updates dynamically. Run `openclaw models list` to see currently available models. Some models may be temporarily offline.
  </Accordion>

  <Accordion title="Connection issues">
    Venice API is at `https://api.venice.ai/api/v1`. Ensure your network allows HTTPS connections.
  </Accordion>
</AccordionGroup>

<Note>
More help: [Troubleshooting](/help/troubleshooting) and [FAQ](/help/faq).
</Note>

## Advanced configuration

<AccordionGroup>
  <Accordion title="Config file example">
    ```json5
    {
      env: { VENICE_API_KEY: "vapi_..." },
      agents: { defaults: { model: { primary: "venice/kimi-k2-5" } } },
      models: {
        mode: "merge",
        providers: {
          venice: {
            baseUrl: "https://api.venice.ai/api/v1",
            apiKey: "${VENICE_API_KEY}",
            api: "openai-completions",
            models: [
              {
                id: "kimi-k2-5",
                name: "Kimi K2.5",
                reasoning: true,
                input: ["text", "image"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 256000,
                maxTokens: 65536,
              },
            ],
          },
        },
      },
    }
    ```
  </Accordion>
</AccordionGroup>

## Related

<CardGroup cols={2}>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Choosing providers, model refs, and failover behavior.
  </Card>
  <Card title="Venice AI" href="https://venice.ai" icon="globe">
    Venice AI homepage and account signup.
  </Card>
  <Card title="API documentation" href="https://docs.venice.ai" icon="book">
    Venice API reference and developer docs.
  </Card>
  <Card title="Pricing" href="https://venice.ai/pricing" icon="credit-card">
    Current Venice credit rates and plans.
  </Card>
</CardGroup>
