import { refreshLineOscuCodes } from './refresh-line-oscu-codes.usecase';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';

/**
 * The live failure this covers (2026-09-09): a QuickBooks item registered as
 * Finished Product got itemCd KE2CTNO0000009, an invoice snapshotted it, then
 * the item was corrected to Service and re-registered as KE3CTNO0000019.
 * KRA rejected the invoice with "Invalid Item: Item KE2CTNO0000009 (itemSeq
 * 1) does not exist in your stock master", and because REJECTED -> RETRYING
 * skips prepare-document, every retry resent the same dead code.
 */
function makeItem(overrides: Partial<ComplianceItem> = {}): ComplianceItem {
  const now = new Date();
  return {
    id: 'item-20',
    merchantId: 'merchant-1',
    name: 'Attachment Flow Test Service',
    sku: null,
    taxCategory: TaxCategory.VAT_ZERO,
    classificationCode: '1000000000',
    unitCode: 'NO',
    packagingUnitCode: 'CT',
    taxTyCd: 'D',
    productTypeCode: '3',
    etimsItemCode: 'KE3CTNO0000019',
    version: 8,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<ComplianceDocument> = {},
): ComplianceDocument {
  const now = new Date();
  return {
    id: 'doc-1',
    merchantId: 'merchant-1',
    branchId: 'branch-1',
    documentType: DocumentType.SALE_INVOICE,
    documentNumber: 'INV-MTFZ7PI2-W5UU2N',
    complianceStatus: ComplianceStatus.REJECTED,
    lines: [
      {
        id: 'line-1',
        documentId: 'doc-1',
        itemId: 'item-20',
        // The orphaned Goods-era code.
        etimsItemCodeSnapshot: 'KE2CTNO0000009',
        description: 'Attachment Flow Test Service',
        quantity: 1,
        unitPrice: 1000,
        taxCategory: TaxCategory.VAT_ZERO,
        taxAmount: 0,
        classificationCodeSnapshot: '1000000000',
        unitCodeSnapshot: 'NO',
        packagingUnitCodeSnapshot: 'NT',
        taxTyCdSnapshot: 'B',
        productTypeCodeSnapshot: '2',
        createdAt: now,
      },
    ],
    ...overrides,
  } as ComplianceDocument;
}

function makeRepos(document: ComplianceDocument, items: ComplianceItem[]) {
  let stored = document;
  return {
    documentRepo: {
      findById: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      save: jest.fn().mockImplementation((d: ComplianceDocument) => {
        stored = d;
        return Promise.resolve(d);
      }),
    },
    itemRepo: { findByIds: jest.fn().mockResolvedValue(items) },
    get stored() {
      return stored;
    },
  };
}

describe('refreshLineOscuCodes', () => {
  it('re-points a rejected sale at the item code its Service re-registration issued', async () => {
    const repos = makeRepos(makeDocument(), [makeItem()]);

    const result = await refreshLineOscuCodes(
      'doc-1',
      repos.documentRepo as any,
      repos.itemRepo as any,
    );

    expect(result.refreshedLines).toBe(1);
    const line = result.document.lines[0];
    expect(line.etimsItemCodeSnapshot).toBe('KE3CTNO0000019');
    // The rest of the code set describes the same registration, so it moves
    // with itemCd -- otherwise the payload pairs a Service itemCd with the
    // Goods packaging/product type the old code was registered under.
    expect(line.productTypeCodeSnapshot).toBe('3');
    expect(line.packagingUnitCodeSnapshot).toBe('CT');
    expect(line.taxTyCdSnapshot).toBe('D');
    expect(repos.documentRepo.save).toHaveBeenCalledTimes(1);
  });

  it('leaves a line alone, and writes nothing, when its code is already current', async () => {
    const doc = makeDocument();
    doc.lines[0].etimsItemCodeSnapshot = 'KE3CTNO0000019';
    doc.lines[0].productTypeCodeSnapshot = '3';
    const repos = makeRepos(doc, [makeItem()]);

    const result = await refreshLineOscuCodes(
      'doc-1',
      repos.documentRepo as any,
      repos.itemRepo as any,
    );

    expect(result.refreshedLines).toBe(0);
    expect(repos.documentRepo.save).not.toHaveBeenCalled();
  });

  it('keeps the line code when the item is mid-resync with no code of its own', async () => {
    // A permanent saveItem rejection clears etimsItemCode; blanking the
    // line's code too would only make the document less submittable.
    const repos = makeRepos(makeDocument(), [
      makeItem({ etimsItemCode: null }),
    ]);

    const result = await refreshLineOscuCodes(
      'doc-1',
      repos.documentRepo as any,
      repos.itemRepo as any,
    );

    expect(result.refreshedLines).toBe(0);
    expect(result.document.lines[0].etimsItemCodeSnapshot).toBe(
      'KE2CTNO0000009',
    );
  });

  it('refuses to touch an ACCEPTED document -- its snapshots are the filed record', async () => {
    const repos = makeRepos(
      makeDocument({ complianceStatus: ComplianceStatus.ACCEPTED }),
      [makeItem()],
    );

    const result = await refreshLineOscuCodes(
      'doc-1',
      repos.documentRepo as any,
      repos.itemRepo as any,
    );

    expect(result.refreshedLines).toBe(0);
    expect(result.document.lines[0].etimsItemCodeSnapshot).toBe(
      'KE2CTNO0000009',
    );
    expect(repos.documentRepo.save).not.toHaveBeenCalled();
  });
});
