import type { CreateSpanPayload, UpdateSpanPayload, SpanResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.opper.ai";

export class OpperSpanClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async createSpan(payload: CreateSpanPayload): Promise<SpanResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/spans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.warn(
          `[opper-tracing] Failed to create span: ${response.status} ${response.statusText}`
        );
        return null;
      }
      return (await response.json()) as SpanResponse;
    } catch (error) {
      console.warn("[opper-tracing] Failed to create span:", error);
      return null;
    }
  }

  async updateSpan(spanId: string, payload: UpdateSpanPayload): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/spans/${spanId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.warn(
          `[opper-tracing] Failed to update span ${spanId}: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.warn(`[opper-tracing] Failed to update span ${spanId}:`, error);
    }
  }
}
