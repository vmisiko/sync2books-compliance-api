import { submitDocument } from './submit-document.usecase';
import { parseExpectedInvcNo } from '../../../regulatory/oscu/mapping/oscu-sequence-drift';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';

const SYNC_KEY = 'invoice_seq:P600004185A:SANDBOX';

/** Verbatim rejection captured live 2026-09-09 against the KRA sandbox. */
const LIVE_DRIFT_ERROR =
  'HTTP 400 calling OSCU: Invc No: 8 is invalid, use the expected value: 9';

describe('parseExpectedInvcNo', () => {
  it('reads the expected value out of the live rejection shape', () => {
    expect(parseExpectedInvcNo(LIVE_DRIFT_ERROR)).toBe(9);
  });

  it('is case- and spacing-tolerant', () => {
    expect(
      parseExpectedInvcNo('invc no:3 is invalid, use the expected value:4'),
    ).toBe(4);
  });

  it('returns null for anything that is not an invcNo drift rejection', () => {
    expect(parseExpectedInvcNo(null)).toBeNull();
    expect(parseExpectedInvcNo(undefined)).toBeNull();
    expect(parseExpectedInvcNo('')).toBeNull();
    // Must not fire on the sibling counters' rejections.
    expect(
      parseExpectedInvcNo('Invalid sarNo: Expected: 10 but found: 15'),
    ).toBeNull();
    expect(
      parseExpectedInvcNo('Invalid itemCd Sequence. Expected ending: ****1'),
    ).toBeNull();
    // orgInvcNo failures are a different bug with a different fix.
    expect(parseExpectedInvcNo('orgInvcNo does not exist')).toBeNull();
  });
});

function makeSyncStateRepo(initial: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    repo: {
      findOne: ({ where: { syncKey } }: { where: { syncKey: string } }) =>
        Promise.resolve(
          store.has(syncKey)
            ? { syncKey, lastReqDt: store.get(syncKey) }
            : null,
        ),
      upsert: ({
        syncKey,
        lastReqDt,
      }: {
        syncKey: string;
        lastReqDt: string;
      }) => {
        store.set(syncKey, lastReqDt);
        return Promise.resolve(undefined);
      },
    },
  };
}

function makeDocument(oscuInvcNo: number | null): ComplianceDocument {
  return {
    id: 'doc-1',
    merchantId: 'merchant-1',
    branchId: 'branch-1',
    documentNumber: 'test-victor',
    sourceDocumentId: 'test-victor',
    complianceStatus: ComplianceStatus.READY_FOR_SUBMISSION,
    submissionAttempts: 0,
    oscuInvcNo,
    originalSaleId: null,
    originalDocumentNumber: null,
    etimsReceiptNumber: null,
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 6300,
    totalAmount: 6300,
    totalTax: 0,
    lines: [],
    submittedAt: null,
    createdAt: new Date(),
  } as unknown as ComplianceDocument;
}

/**
 * The third counter with this failure mode. Confirmed live 2026-09-09: with the
 * sarNo drift fixed, the very next sale was rejected with "Invc No: 8 is
 * invalid, use the expected value: 9" -- the same shared-PIN drift, one counter
 * over. Like sarNo (and unlike itemCd, whose rejection masks the value behind
 * asterisks) KRA names the expected value, so the repair needs no probe call.
 */
describe('submitDocument -- invcNo drift self-heal', () => {
  function harness(initialCounter: string, submitInvoice: jest.Mock) {
    const state = makeSyncStateRepo({ [SYNC_KEY]: initialCounter });
    const saved: ComplianceDocument[] = [];
    let current = makeDocument(Number(initialCounter) + 1);

    const documentRepo = {
      findById: (id: string) =>
        Promise.resolve(id === 'doc-1' ? current : null),
      save: (d: ComplianceDocument) => {
        saved.push(d);
        current = d;
        return Promise.resolve(d);
      },
    };
    const connectionRepo = {
      findByMerchantAndBranch: () =>
        Promise.resolve({
          id: 'conn-1',
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          kraPin: 'P600004185A',
          kraBhfId: '00',
          cmcKey: 'cmc-key',
          deviceId: 'device-1',
          environment: 'SANDBOX',
          status: ConnectionStatus.ACTIVE,
        }),
    };
    const eventRepo = { append: jest.fn().mockResolvedValue(undefined) };

    return {
      state,
      saved,
      run: () =>
        submitDocument(
          'doc-1',
          documentRepo as never,
          connectionRepo as never,
          eventRepo as never,
          { submitInvoice } as never,
          state.repo as never,
        ),
    };
  }

  it('corrects the counter and the document, then retries once and is accepted', async () => {
    const submitInvoice = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: LIVE_DRIFT_ERROR })
      .mockResolvedValueOnce({ success: true, receiptNumber: '9' });

    // Counter at 7 -> the document carries invcNo 8, exactly the live case.
    const h = harness('7', submitInvoice);
    const result = await h.run();

    expect(submitInvoice).toHaveBeenCalledTimes(2);
    expect(submitInvoice.mock.calls[0][0].invoiceSequence).toBe(8);
    // The retry must carry the value KRA asked for, rebuilt from the document.
    expect(submitInvoice.mock.calls[1][0].invoiceSequence).toBe(9);

    expect(h.state.store.get(SYNC_KEY)).toBe('9');
    expect(result.success).toBe(true);
    expect(result.document.complianceStatus).toBe(ComplianceStatus.ACCEPTED);
    expect(result.document.oscuInvcNo).toBe(9);
  });

  it('does not retry when KRA echoes back the value already sent', async () => {
    // Guards the degenerate case: retrying an identical submission is pointless.
    const submitInvoice = jest.fn().mockResolvedValue({
      success: false,
      error: 'Invc No: 8 is invalid, use the expected value: 8',
    });

    const h = harness('7', submitInvoice);
    await h.run();

    expect(submitInvoice).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-drift rejection to the existing release path', async () => {
    const submitInvoice = jest.fn().mockResolvedValue({
      success: false,
      error: 'HTTP 400 calling OSCU: orgInvcNo does not exist',
    });

    const h = harness('7', submitInvoice);
    const result = await h.run();

    expect(submitInvoice).toHaveBeenCalledTimes(1);
    expect(result.document.complianceStatus).toBe(ComplianceStatus.REJECTED);
    // releaseInvoiceSequence rolls 8 back to 7 so the next document reuses it.
    expect(h.state.store.get(SYNC_KEY)).toBe('7');
  });
});
