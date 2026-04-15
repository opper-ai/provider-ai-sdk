/**
 * Normalize a tool call ID for cross-provider compatibility.
 *
 * The OpenAI Responses API produces IDs that are 450+ characters long and may
 * contain pipe characters and base64 padding (e.g. `call_abc123|<long-base64>`).
 * Providers like Anthropic require IDs that match ^[a-zA-Z0-9_-]+$ (max 64 chars).
 *
 * Strategy: strip after the pipe (Responses API format), sanitize remaining
 * characters, and truncate to 40 chars (safe for all known providers).
 */
export function normalizeToolCallId(id: string): string {
  let normalized = id;

  // Responses API format: `{call_id}|{long_base64_id}`
  if (normalized.includes("|")) {
    normalized = normalized.split("|")[0];
  }

  // Strip any chars outside [a-zA-Z0-9_-]
  normalized = normalized.replace(/[^a-zA-Z0-9_-]/g, "_");

  // Truncate to 40 chars
  return normalized.slice(0, 40);
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Returns {} if parsing fails entirely.
 */
export function parseStreamingJson<T = Record<string, unknown>>(
  partial: string | undefined
): T {
  if (!partial || partial.trim() === "") return {} as T;
  try {
    return JSON.parse(partial) as T;
  } catch {
    // Try to recover a partial object by appending closing braces
    const attempts = [partial + "}", partial + "}}", partial + '"}'];
    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt) as T;
      } catch {
        // continue
      }
    }
    return {} as T;
  }
}
