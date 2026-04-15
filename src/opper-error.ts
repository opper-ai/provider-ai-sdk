/**
 * Opper error schema and failed response handler.
 * Uses @ai-sdk/provider-utils createJsonErrorResponseHandler — the standard
 * pattern used by all first-party AI SDK providers.
 */

import { createJsonErrorResponseHandler, createStatusCodeErrorResponseHandler } from "@ai-sdk/provider-utils";
import { z } from "zod";

const opperErrorSchema = z.object({
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
  detail: z.string().optional(),
  message: z.string().optional(),
});

export type OpperErrorData = z.infer<typeof opperErrorSchema>;

export const opperFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: opperErrorSchema,
  errorToMessage: (data) =>
    data.error?.message ?? data.detail ?? data.message ?? "Unknown Opper API error",
  isRetryable: (response) => response.status >= 500 && response.status < 600,
});
