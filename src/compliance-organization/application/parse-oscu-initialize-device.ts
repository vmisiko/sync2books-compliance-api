/**
 * Parses `data.info` from OSCU initialize / selectInitOsdcInfo-style responses
 * (`resultCd` 000, body includes `data.info` with `cmcKey`, `dvcId`, …).
 */
export function parseOscuInitializeDeviceInfo(raw: Record<string, unknown>): {
  cmcKey: string;
  dvcId: string;
  tin?: string;
  bhfId?: string;
} | null {
  const data = raw['data'];
  if (!data || typeof data !== 'object') return null;
  const info = (data as Record<string, unknown>)['info'];
  if (!info || typeof info !== 'object') return null;
  const o = info as Record<string, unknown>;
  const cmcKey = typeof o.cmcKey === 'string' ? o.cmcKey : '';
  const dvcId = typeof o.dvcId === 'string' ? o.dvcId : '';
  if (!cmcKey || !dvcId) return null;
  return {
    cmcKey,
    dvcId,
    tin: typeof o.tin === 'string' ? o.tin : undefined,
    bhfId: typeof o.bhfId === 'string' ? o.bhfId : undefined,
  };
}
