import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/selectInitOsdcInfo` response DTOs (device initialization).
 * Source: JSON sample includes `data.info`.
 */
export interface OscuInitDeviceInfo {
  tin: string;
  taxprNm: string;
  bsnsActv: string;
  bhfId: string;
  bhfNm: string;
  bhfOpenDt: string;
  prvncNm: string;
  dstrtNm: string;
  sctrNm: string;
  locDesc: string;
  hqYn: 'Y' | 'N';
  mgrNm: string;
  mgrTelNo: string;
  mgrEmail: string;
  dvcId: string;
  sdcId: string;
  mrcNo: string;
  cmcKey: string;
}

export interface OscuInitDeviceData {
  info: OscuInitDeviceInfo;
}

export type OscuInitDeviceRes = OscuApiResponse<OscuInitDeviceData>;
