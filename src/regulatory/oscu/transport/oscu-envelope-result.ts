/**
 * Normalized outcome for OSCU JSON APIs that return `resultCd` / `resultMsg` / `data`.
 */
export type OscuEnvelopeResponse = {
  success: boolean;
  rawResponse?: Record<string, unknown>;
  error?: string;
};
