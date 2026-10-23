/**
 * Opper-specific per-call options, passed via `providerOptions.opper`.
 *
 * Each option is sent as a request header and removed from the request body.
 *
 * @example
 * ```ts
 * await generateText({
 *   model: opper('claude-sonnet-4-6'),
 *   prompt: 'Hello',
 *   providerOptions: {
 *     opper: { name: 'my-function' } satisfies OpperCallOptions,
 *   },
 * });
 * ```
 */
export interface OpperCallOptions {
  /**
   * Function name for tracing in the Opper platform.
   * Sent as the `X-Opper-Name` request header.
   */
  name?: string;

  /**
   * Parent span ID (UUID) for distributed tracing context.
   * Sent as the `X-Opper-Parent-Span-Id` request header.
   */
  parentSpanId?: string;
}
