/**
 * Zod schemas for Opper compat endpoint responses.
 * Used with createJsonResponseHandler / createEventSourceResponseHandler.
 */

import { z } from "zod";

// ── Non-streaming response ────────────────────────────────────────────────────

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export const opperChatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.literal("assistant"),
        content: z.string().nullable().optional(),
        tool_calls: z.array(toolCallSchema).optional(),
      }),
      finish_reason: z.string().nullable().optional(),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export type OpperChatResponse = z.infer<typeof opperChatResponseSchema>;

// ── Streaming chunk ───────────────────────────────────────────────────────────

const toolCallDeltaSchema = z.object({
  index: z.number(),
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z
    .object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
});

export const opperChatChunkSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.number(),
        delta: z.object({
          role: z.string().optional(),
          content: z.string().nullable().optional(),
          tool_calls: z.array(toolCallDeltaSchema).optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullable()
    .optional(),
});

export type OpperChatChunk = z.infer<typeof opperChatChunkSchema>;
