/**
 * Opper-specific chat model settings.
 *
 * These are passed as provider options and translated into
 * Opper-specific request headers or body fields.
 */
export interface OpperChatSettings {
  /**
   * Opper function name — used for tracing and routing.
   * Sent as the X-Opper-Name request header.
   */
  name?: string;

  /**
   * Parent span ID for distributed tracing context.
   * Sent as the X-Opper-Parent-Span-Id request header.
   */
  parentSpanId?: string;

  /**
   * Comma-separated list of input guardrail checks to apply.
   * Example: "pii,secrets"
   * Sent as the X-Opper-Guard-Input request header.
   */
  guardInput?: string;

  /**
   * Comma-separated list of output guardrail checks to apply.
   * Example: "toxicity"
   * Sent as the X-Opper-Guard-Output request header.
   */
  guardOutput?: string;

  /**
   * Action to take when a guardrail violation is detected.
   * Defaults to "flag".
   */
  guardAction?: 'flag' | 'block' | 'redact';
}
