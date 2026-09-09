import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';

const ETIMS_RECEIPT_PATH = '/common/link/etims/receipt/indexEtimsReceiptData';

const ETIMS_RECEIPT_HOST: Record<ConnectionEnvironment, string> = {
  [ConnectionEnvironment.PRODUCTION]: 'https://etims.kra.go.ke',
  [ConnectionEnvironment.SANDBOX]: 'https://etims-sbx.kra.go.ke',
};

/** KRA branch office codes are two digits ("00", "02"). */
const KRA_BHF_ID_LENGTH = 2;

/**
 * Builds the KRA eTIMS receipt-verification link that goes into `etimsUrl`
 * on the sale report DTO and into the QR code on the receipt PDF.
 *
 * Verified live against the KRA sandbox portal 2026-09-09: this format
 * returns the real receipt ("Invoice Number : KRACU0400001074/9 ... End of
 * Legal Receipt"). The format we shipped before that date was wrong in five
 * separate ways and could never have worked:
 *
 * 1. Path typo `indexEtimsReceptData` -- KRA's route is `indexEtimsReceiptData`
 *    ("Receipt", not "Recept"). The typo hit the portal's own 404 page.
 * 2. Missing the `Data=` query-parameter name entirely.
 * 3. Literal `{` / `}` braces around the payload. These are invalid in an
 *    HTTP request target (RFC 7230 / 3986), so KRA's Tomcat rejected the
 *    request with a 400 before any application code ran. The braces almost
 *    certainly came from reading a spec's `{placeholder}` notation literally.
 * 4. `+` separators between the segments. There are none -- see below.
 * 5. `document.branchId` (a sync2books-internal UUID) where KRA wants its own
 *    branch office code, `connection.kraBhfId`.
 *
 * **The payload is positional, fixed-width concatenation with no separators**:
 * an 11-character KRA PIN, then the 2-character branch code, then the
 * 16-character receipt signature. KRA's portal slices it by offset, which is
 * why (5) was fatal rather than cosmetic -- a 36-character UUID in the middle
 * slot destroys the parse of everything after it.
 *
 * The host is environment-specific: a SANDBOX submission only ever resolves
 * on `etims-sbx.kra.go.ke`, never on the production host.
 *
 * Returns `null` rather than a malformed link whenever a segment is missing or
 * the wrong width -- a broken URL is worse than none here, because it still
 * renders as a scannable QR code on a customer's receipt.
 */
export function buildEtimsReceiptUrl(
  connection:
    | Pick<ComplianceConnection, 'kraPin' | 'kraBhfId' | 'environment'>
    | null
    | undefined,
  rcptSign: string | null | undefined,
): string | null {
  if (!connection?.kraPin || !connection.kraBhfId || !rcptSign) {
    return null;
  }

  const bhfId = connection.kraBhfId.trim().padStart(KRA_BHF_ID_LENGTH, '0');
  // Guards against the internal-branch-UUID regression: anything wider than a
  // branch code would silently shift every following character of the payload.
  if (bhfId.length !== KRA_BHF_ID_LENGTH) {
    return null;
  }

  const host =
    ETIMS_RECEIPT_HOST[connection.environment] ??
    ETIMS_RECEIPT_HOST[ConnectionEnvironment.SANDBOX];

  return `${host}${ETIMS_RECEIPT_PATH}?Data=${connection.kraPin}${bhfId}${rcptSign}`;
}
