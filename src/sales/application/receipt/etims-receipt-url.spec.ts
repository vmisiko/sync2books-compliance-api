import { buildEtimsReceiptUrl } from './etims-receipt-url';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';

/**
 * Regression guard for the etimsUrl format, rebuilt 2026-09-09 after the link
 * was verified live against KRA's sandbox portal. See the builder's doc
 * comment for the five separate defects this locks down. The payload is
 * positional fixed-width concatenation -- 11-char PIN, 2-char branch code,
 * 16-char signature -- so a wrong-width middle segment corrupts the whole
 * lookup, not just one field.
 *
 * `.claude/rules/etims-payload-rules.md`: "`bhfId` is KRA's real branch code
 * (`connection.kraBhfId`), never a sync2books-internal branch id."
 */
describe('buildEtimsReceiptUrl', () => {
  // Real values from the ACCEPTED sandbox sale that exposed the bug
  // (receiptNumber 9). Confirmed to resolve to the genuine receipt at
  // etims-sbx.kra.go.ke on 2026-09-09.
  const KRA_PIN = 'P600004185A';
  const KRA_BHF_ID = '00';
  const INTERNAL_BRANCH_ID = 'd7e7b90b-d4e6-4f4e-a3df-bd7539d24034';
  const RCPT_SIGN = 'UEKEZNJ4BXML4OU3';

  const sandboxConnection = {
    kraPin: KRA_PIN,
    kraBhfId: KRA_BHF_ID,
    environment: ConnectionEnvironment.SANDBOX,
  };

  function payloadOf(url: string): string {
    return new URL(url).searchParams.get('Data') as string;
  }

  it('builds the live-verified sandbox link', () => {
    expect(buildEtimsReceiptUrl(sandboxConnection, RCPT_SIGN)).toBe(
      'https://etims-sbx.kra.go.ke/common/link/etims/receipt/' +
        `indexEtimsReceiptData?Data=${KRA_PIN}${KRA_BHF_ID}${RCPT_SIGN}`,
    );
  });

  it('uses the production host for a production connection', () => {
    const url = buildEtimsReceiptUrl(
      { ...sandboxConnection, environment: ConnectionEnvironment.PRODUCTION },
      RCPT_SIGN,
    );

    expect(url).toContain('https://etims.kra.go.ke/');
    expect(url).not.toContain('etims-sbx');
  });

  it("spells KRA's route as indexEtimsReceiptData", () => {
    // The original typo ("Recept") hit KRA's own 404 page.
    const url = buildEtimsReceiptUrl(sandboxConnection, RCPT_SIGN) as string;

    expect(url).toContain('/indexEtimsReceiptData?');
    expect(url).not.toContain('ReceptData');
  });

  it('emits a request target with no braces or separators', () => {
    // Literal `{`/`}` are invalid in an HTTP request target and made KRA's
    // Tomcat return 400 before any application code ran.
    const url = buildEtimsReceiptUrl(sandboxConnection, RCPT_SIGN) as string;

    expect(url).not.toMatch(/[{}]/);
    expect(payloadOf(url)).toBe(`${KRA_PIN}${KRA_BHF_ID}${RCPT_SIGN}`);
    expect(payloadOf(url)).not.toContain('+');
    expect(payloadOf(url)).not.toContain(' ');
  });

  it('places kraBhfId in the branch slot, never the internal branch id', () => {
    const url = buildEtimsReceiptUrl(
      // A connection carrying the internal branchId alongside kraBhfId -- the
      // exact shape the buggy code read the wrong field from.
      { ...sandboxConnection, branchId: INTERNAL_BRANCH_ID } as never,
      RCPT_SIGN,
    ) as string;

    const payload = payloadOf(url);
    expect(payload).not.toContain(INTERNAL_BRANCH_ID);
    expect(payload.slice(KRA_PIN.length, KRA_PIN.length + 2)).toBe(KRA_BHF_ID);
  });

  it('keeps the payload positionally sliceable by KRA', () => {
    const payload = payloadOf(
      buildEtimsReceiptUrl(sandboxConnection, RCPT_SIGN) as string,
    );

    // 11-char PIN + 2-char branch + 16-char signature.
    expect(payload).toHaveLength(29);
    expect(payload.slice(0, 11)).toBe(KRA_PIN);
    expect(payload.slice(11, 13)).toBe(KRA_BHF_ID);
    expect(payload.slice(13)).toBe(RCPT_SIGN);
  });

  it('left-pads a single-digit branch code to two digits', () => {
    const payload = payloadOf(
      buildEtimsReceiptUrl(
        { ...sandboxConnection, kraBhfId: '2' },
        RCPT_SIGN,
      ) as string,
    );

    expect(payload.slice(11, 13)).toBe('02');
    expect(payload).toHaveLength(29);
  });

  it.each([
    ['no connection', null],
    ['no kraPin', { ...sandboxConnection, kraPin: '' }],
    // kraBhfId is nullable until the branch is registered with KRA.
    ['unset kraBhfId', { ...sandboxConnection, kraBhfId: null }],
    // The original bug: a UUID here shifts every following character.
    [
      'an internal branch UUID as kraBhfId',
      {
        ...sandboxConnection,
        kraBhfId: INTERNAL_BRANCH_ID,
      },
    ],
  ])('returns null given %s', (_label, conn) => {
    expect(buildEtimsReceiptUrl(conn, RCPT_SIGN)).toBeNull();
  });

  it.each([
    ['null', null],
    ['empty', ''],
  ])('returns null given a %s rcptSign', (_label, sign) => {
    expect(buildEtimsReceiptUrl(sandboxConnection, sign)).toBeNull();
  });
});
