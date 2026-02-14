/**
 * Idempotency key generation.
 * Prevents duplicate submissions.
 */
export function generateIdempotencyKey(
  merchantId: string,
  sourceDocumentId: string,
  documentType: string,
): string {
  return `${merchantId}:${sourceDocumentId}:${documentType}`;
}
