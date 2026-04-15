// Shared types for the Task API AI SDK provider

export interface TaskProviderOptions {
  /** Base URL for the Task API (default: http://localhost:8080) */
  baseUrl?: string;
  /** Base URL (alias for baseUrl, used by OpenCode) */
  baseURL?: string;
  /** Function name for caching and state management */
  name?: string;
  /** Model preference hint */
  prefer?: "fast" | "cheap" | "quality" | "balanced";
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Opper API key for auth headers and tracing */
  apiKey?: string;
  /** Parent span ID for tracing context */
  parentSpanId?: string;
}

export interface TaskModelConfig extends TaskProviderOptions {
  /** Model ID to use */
  modelId: string;
  /** Model-level name override (set via model options parameter) */
  modelName?: string;
  /** Model-level parent span ID override */
  modelParentSpanId?: string;
}

/**
 * Options that can be passed when creating a model instance.
 * Allows per-model configuration that overrides provider defaults.
 */
export interface TaskModelOptions {
  /** Function name for caching and state management (overrides provider-level name) */
  name?: string;
  /** Parent span ID for tracing context (overrides provider-level) */
  parentSpanId?: string;
}

// Task API message types (matches sdk/typescript/src/chat.ts)

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "pdf"; pdf: string }
  | { type: "audio"; audio: string }
  | { type: "video"; video: string };

export interface TaskMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: TaskToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface TaskToolCall {
  id: string;
  type?: string;
  name?: string;
  function?: {
    name: string;
    arguments: string;
  };
  arguments?: Record<string, unknown>;
  thought_signature?: string;
}

export interface TaskTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface TaskChatRequest {
  messages: TaskMessage[];
  tools?: TaskTool[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

export interface TaskChatResponse {
  id?: string;
  object?: string;
  model?: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content?: string;
      tool_calls?: TaskToolCall[];
    };
    finish_reason?: "stop" | "tool_calls" | "length";
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Task API run request/response

export interface TaskRunRequest {
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  input: Record<string, unknown>;
  hints?: {
    prefer?: "fast" | "cheap" | "quality" | "balanced";
    model?: string;
    instructions?: string;
  };
}

export interface TaskRunResponse {
  data: TaskChatResponse;
  meta?: {
    message?: string;
    function_name: string;
    script_cached: boolean;
    generation_ms?: number;
    execution_ms: number;
    llm_calls: number;
    models_used?: string[];
  };
}

// Opper API v2 span types

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
