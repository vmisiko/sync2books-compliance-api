import { ConnectionEnvironment } from '../enums/connection-environment.enum';
import { ConnectionStatus } from '../enums/connection-status.enum';

/**
 * Represents a merchant's KRA link.
 * Required before any document submission.
 */
export interface ComplianceConnection {
  id: string;
  merchantId: string;
  kraPin: string;
  /** Internal/sync2books branch id -- NOT the KRA office code, use {@link kraBhfId} for OSCU calls. */
  branchId: string;
  /** KRA branch office id (OSCU `bhfId`), e.g. "00". Required for any real OSCU request. */
  kraBhfId: string | null;
  deviceId: string;
  /** Serial used in initialize request (`dvcSrlNo`); optional after init. */
  dvcSrlNo?: string | null;
  /**
   * OSCU/SCU identification (`data.info.sdcId` from `/selectInitOsdcInfo`), e.g.
   * "KRACU0400001074". This -- NOT {@link deviceId} (the OSCU-internal `dvcId`) -- is the
   * "CU ID" and "SCU ID" the TIS spec (page 8/10 samples, §6.23.3-4) requires printed on
   * every receipt, and the value embedded in the CU Invoice No. (`{sdcId}/{curRcptNo}`).
   * Null until `/selectInitOsdcInfo` has been captured for this connection.
   */
  sdcId: string | null;
  /** OSCU merchant/registration code (`data.info.mrcNo`) from the same initialize response. */
  mrcNo: string | null;
  /** Trade address line, for the receipt header (TIS page 8 "Shop address"). Merchant-editable; null until set. */
  tradeAddressLine1: string | null;
  /** Trade city, for the receipt header. */
  tradeCity: string | null;
  /** Commercial message printed above the item list (TIS page 8 sample: "Welcome to our shop"). Null falls back to a generic default at render time. */
  receiptHeaderMessage: string | null;
  /** Commercial message printed in the footer (TIS page 8 sample: "THANK YOU ..."). Null falls back to a generic default at render time. */
  receiptFooterMessage: string | null;
  environment: ConnectionEnvironment;
  status: ConnectionStatus;
  cmcKey: string;
  lastCodeSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
