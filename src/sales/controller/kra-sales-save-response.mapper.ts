import type { KraSalesSaveResponseDto } from './dto/sale-response.dto';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return String(value);
  return '';
}

/**
 * Extracts the exact `/saveTrnsSalesOsdc` response shape from a stored snapshot.
 *
 * Notes:
 * - The OSCU spec sometimes shows `curRcptNo ` / `totRcptNo ` with a trailing space
 *   (artifact of PDF/text extraction). We support both keys.
 * - Any non-primitive values are normalized to empty string to avoid misleading
 *   `[object Object]` stringification.
 */
export function toKraSalesSaveResponseDto(
  raw: Record<string, unknown> | null,
): KraSalesSaveResponseDto | null {
  if (!raw) return null;

  const dataRaw = asRecord(raw.data);
  const curRcptNo = dataRaw?.curRcptNo ?? dataRaw?.['curRcptNo '];
  const totRcptNo = dataRaw?.totRcptNo ?? dataRaw?.['totRcptNo '];

  return {
    resultCd: asString(raw.resultCd),
    resultMsg: asString(raw.resultMsg),
    resultDt: asString(raw.resultDt),
    data: dataRaw
      ? {
          curRcptNo: asString(curRcptNo),
          totRcptNo: asString(totRcptNo),
          intrlData: asString(dataRaw.intrlData),
          rcptSign: asString(dataRaw.rcptSign),
          sdcDateTime: asString(dataRaw.sdcDateTime),
        }
      : null,
  };
}
