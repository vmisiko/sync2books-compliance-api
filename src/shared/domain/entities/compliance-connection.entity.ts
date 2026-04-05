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
  branchId: string;
  deviceId: string;
  /** Serial used in initialize request (`dvcSrlNo`); optional after init. */
  dvcSrlNo?: string | null;
  environment: ConnectionEnvironment;
  status: ConnectionStatus;
  cmcKey: string;
  lastCodeSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
