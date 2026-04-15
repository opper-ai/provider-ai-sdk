/**
 * Shared fetch helper for the Opper function API (/v3/functions/{name}/call).
 * Used by image, speech, and transcription models.
 */

import type { OpperModelConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://api.opper.ai";

export interface FunctionCallOptions {
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
}

export interface FunctionCallResult {
  data: Record<string, unknown>;
}

export async function callOpperFunction(
  config: OpperModelConfig,
  input: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  hints: Record<string, unknown>,
  options: FunctionCallOptions
): Promise<FunctionCallResult> {
  const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const opperOpts = options.providerOptions?.opper as
    | { name?: string; parentSpanId?: string }
    | undefined;

  const functionName =
    opperOpts?.name ?? config.modelName ?? config.name ?? "ai-sdk";
  const parentSpanId =
    opperOpts?.parentSpanId ?? config.modelParentSpanId ?? config.parentSpanId;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = config.apiKey ?? (typeof process !== "undefined" ? process.env.OPPER_API_KEY : undefined) ?? "";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["X-Opper-Name"] = functionName;
  if (parentSpanId) headers["X-Opper-Parent-Span-Id"] = parentSpanId;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? 120_000
  );

  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(
      `${baseURL}/v3/functions/${encodeURIComponent(functionName)}/call`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input_schema: inputSchema,
          output_schema: outputSchema,
          input,
          hints,
        }),
        signal,
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const msg =
        ((body.error as Record<string, unknown> | undefined)?.message as string | undefined) ??
        (body.detail as string | undefined) ??
        response.statusText;
      throw new Error(`Opper API error ${response.status}: ${msg}`);
    }

    const result = await response.json() as Record<string, unknown>;
    return { data: (result.data as Record<string, unknown>) ?? {} };
  } finally {
    clearTimeout(timeoutId);
  }
}
