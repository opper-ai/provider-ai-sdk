/**
 * Message transformation: AI SDK LanguageModelV3Prompt → OpenAI chat messages.
 *
 * Applies the same defensive patterns as the pi provider:
 * - Skips empty text blocks and contentless assistant turns
 * - Inserts synthetic tool results for orphaned tool calls
 * - Normalizes tool call IDs for cross-provider compatibility
 * - Sanitizes Unicode surrogates
 * - Handles all AI SDK content part types (text, file, tool-call, tool-result)
 */

import type {
  LanguageModelV3Prompt,
  LanguageModelV3ToolCallPart,
} from "@ai-sdk/provider";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { sanitizeSurrogates } from "./sanitize.js";
import { normalizeToolCallId } from "./utils.js";

export function convertMessages(
  prompt: LanguageModelV3Prompt
): ChatCompletionMessageParam[] {
  // ── Pass 1: normalize tool call IDs across assistant messages ───────────────
  // Build a stable map of original → normalized IDs so tool results can
  // be matched back correctly.
  const idMap = new Map<string, string>();

  for (const msg of prompt) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type !== "tool-call") continue;
      const normalized = normalizeToolCallId(part.toolCallId);
      if (normalized !== part.toolCallId) {
        idMap.set(part.toolCallId, normalized);
      }
    }
  }

  const resolveId = (id: string) => idMap.get(id) ?? id;

  // ── Pass 2: track tool calls to detect orphans ───────────────────────────
  // We need a second pass because we can only emit synthetic tool results
  // once we know whether a real result follows.
  const pendingToolCalls = new Map<
    string,
    { toolName: string; normalizedId: string }
  >();

  const result: ChatCompletionMessageParam[] = [];

  for (const msg of prompt) {
    // Flush orphaned tool calls before a new user turn
    if (msg.role === "user" && pendingToolCalls.size > 0) {
      for (const [, { toolName, normalizedId }] of pendingToolCalls) {
        result.push({
          role: "tool",
          tool_call_id: normalizedId,
          content: JSON.stringify({
            error: `Tool ${toolName} was called but no result was provided`,
          }),
        });
      }
      pendingToolCalls.clear();
    }

    if (msg.role === "system") {
      result.push({ role: "system", content: sanitizeSurrogates(msg.content) });
    } else if (msg.role === "user") {
      const parts = msg.content;

      // Simple string content
      if (parts.length === 1 && parts[0].type === "text") {
        const text = sanitizeSurrogates(parts[0].text);
        if (text.trim().length > 0) {
          result.push({ role: "user", content: text });
        }
        continue;
      }

      // Multi-part content
      const contentParts: OpenAI.ChatCompletionContentPart[] = [];
      for (const part of parts) {
        if (part.type === "text") {
          const text = sanitizeSurrogates(part.text);
          if (text.trim().length > 0) {
            contentParts.push({ type: "text", text });
          }
        } else if (part.type === "file") {
          // Convert file parts to image_url (OpenAI multimodal format)
          if (part.mediaType.startsWith("image/")) {
            const url =
              part.data instanceof URL
                ? part.data.toString()
                : typeof part.data === "string"
                  ? `data:${part.mediaType};base64,${part.data}`
                  : `data:${part.mediaType};base64,${uint8ArrayToBase64(part.data)}`;

            contentParts.push({ type: "image_url", image_url: { url } });
          }
          // Non-image files (PDF, audio, video) are not universally supported
          // in OpenAI compat endpoints — skip silently rather than erroring.
        }
      }
      if (contentParts.length > 0) {
        result.push({ role: "user", content: contentParts });
      }
    } else if (msg.role === "assistant") {
      const textParts = msg.content
        .filter(
          (p): p is { type: "text"; text: string } =>
            p.type === "text" && p.text.trim().length > 0
        )
        .map((p) => sanitizeSurrogates(p.text));

      const toolCallParts = msg.content.filter(
        (p): p is LanguageModelV3ToolCallPart => p.type === "tool-call"
      );

      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] =
        toolCallParts.map((tc) => {
          const normalizedId = resolveId(tc.toolCallId);
          const args =
            typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input);
          return {
            id: normalizedId,
            type: "function" as const,
            function: { name: tc.toolName, arguments: args },
          };
        });

      // Skip completely empty assistant turns — some providers reject them
      if (textParts.length === 0 && toolCalls.length === 0) continue;

      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: textParts.join("\n") || null,
      };

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
        // Track as pending so we can insert synthetics if no result follows
        for (const tc of toolCallParts) {
          const normalizedId = resolveId(tc.toolCallId);
          pendingToolCalls.set(normalizedId, {
            toolName: tc.toolName,
            normalizedId,
          });
        }
      }

      result.push(assistantMsg);
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type !== "tool-result") continue;

        const normalizedId = resolveId(part.toolCallId);

        // Mark this tool call as resolved
        pendingToolCalls.delete(normalizedId);

        const outputText =
          typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output ?? "");

        result.push({
          role: "tool",
          tool_call_id: normalizedId,
          content: sanitizeSurrogates(outputText),
        });
      }
    }
  }

  // Flush any remaining orphaned tool calls at end of conversation
  for (const [, { toolName, normalizedId }] of pendingToolCalls) {
    result.push({
      role: "tool",
      tool_call_id: normalizedId,
      content: JSON.stringify({
        error: `Tool ${toolName} was called but no result was provided`,
      }),
    });
  }

  return result;
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}
