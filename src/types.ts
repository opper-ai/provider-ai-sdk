/**
 * Shared types for the Opper AI SDK provider.
 */

export interface OpperProviderOptions {
  /** Opper API key. Falls back to OPPER_API_KEY env var. */
  apiKey?: string;
  /** Base URL for the Opper API. Default: https://api.opper.ai */
  baseURL?: string;
  /** Request timeout in milliseconds. Default: 120000 */
  timeoutMs?: number;
  /** Default function name for tracing / caching. */
  name?: string;
  /** Default parent span ID for tracing. */
  parentSpanId?: string;
}

export interface OpperModelOptions {
  /** Optional function name for Opper tracing / caching. */
  name?: string;
  /** Parent span ID for nested tracing. */
  parentSpanId?: string;
}

export interface OpperModelConfig extends OpperProviderOptions {
  modelId: string;
  /** Model-level name override (from model options). */
  modelName?: string;
  /** Model-level parent span ID override. */
  modelParentSpanId?: string;
}

// ── Opper span API types ──────────────────────────────────────────────────────

export interface CreateSpanPayload {
  name: string;
  type?: string;
  input?: unknown;
  output?: unknown;
  start_time?: string;
  end_time?: string;
  parent_id?: string;
  trace_id?: string;
  meta?: Record<string, unknown>;
  error?: string;
}

export interface UpdateSpanPayload {
  end_time?: string;
  output?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface SpanResponse {
  id: string;
  name: string;
  trace_id: string;
  parent_id?: string;
  type?: string;
  start_time?: string;
  end_time?: string;
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
}
