/**
 * Opper-specific per-call options, passed via `providerOptions.opper`.
 *
 * @example
 * ```ts
 * await generateText({
 *   model: opper('openai/gpt-4o'),
 *   prompt: 'Hello',
 *   providerOptions: {
 *     opper: {
 *       name: 'my-function',
 *       guardInput: 'pii,secrets',
 *       guardAction: 'block',
 *     } satisfies OpperCallOptions,
 *   },
 * });
 * ```
 */
export interface OpperCallOptions {
  /**
   * Function name for tracing and routing in the Opper platform.
   * Sent as the `X-Opper-Name` request header.
   */
  name?: string;

  /**
   * Parent span ID for distributed tracing context (UUID).
   * Sent as the `X-Opper-Parent-Span-Id` request header.
   */
  parentSpanId?: string;

  /**
   * Comma-separated list of input guardrail checks to apply.
   * Example: `"pii,secrets"`
   * Sent as the `X-Opper-Guard-Input` request header.
   */
  guardInput?: string;

  /**
   * Comma-separated list of output guardrail checks to apply.
   * Example: `"toxicity"`
   * Sent as the `X-Opper-Guard-Output` request header.
   */
  guardOutput?: string;

  /**
   * Action to take when a guardrail violation is detected.
   * Defaults to `"flag"`.
   * Sent as the `X-Opper-Guard-Action` request header.
   */
  guardAction?: 'flag' | 'block' | 'redact';
}
