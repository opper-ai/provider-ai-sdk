/**
 * Remove unpaired Unicode surrogates that break JSON serialization.
 * Replaces them with U+FFFD (replacement character).
 */
export function sanitizeSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD"
  );
}
