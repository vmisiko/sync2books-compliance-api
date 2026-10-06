import { getSaleEditability } from './sale-editability';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';

const manualSale = {
  documentType: DocumentType.SALE,
  complianceStatus: ComplianceStatus.READY_FOR_SUBMISSION,
  sourceSystem: SourceSystem.MANUAL,
  sourceInvoiceId: null,
  submittedAt: null,
  oscuInvcNo: null,
  etimsReceiptNumber: null,
};

describe('getSaleEditability', () => {
  it.each([
    ComplianceStatus.DRAFT,
    ComplianceStatus.VALIDATED,
    ComplianceStatus.READY_FOR_SUBMISSION,
  ])('allows a manual sale in %s', (complianceStatus) => {
    expect(getSaleEditability({ ...manualSale, complianceStatus }).editable).toBe(true);
  });

  it.each([
    ComplianceStatus.SUBMITTED,
    ComplianceStatus.ACCEPTED,
    ComplianceStatus.REJECTED,
    ComplianceStatus.RETRYING,
    ComplianceStatus.FAILED,
    ComplianceStatus.CANCELLED,
  ])('blocks a sale in %s', (complianceStatus) => {
    expect(getSaleEditability({ ...manualSale, complianceStatus }).editable).toBe(false);
  });

  it('blocks ERP-sourced sales (by source system or sourceInvoiceId)', () => {
    expect(getSaleEditability({ ...manualSale, sourceSystem: SourceSystem.QUICKBOOKS }).editable).toBe(false);
    expect(getSaleEditability({ ...manualSale, sourceSystem: SourceSystem.API }).editable).toBe(false);
    expect(getSaleEditability({ ...manualSale, sourceInvoiceId: 'inv-1' }).editable).toBe(false);
  });

  it('blocks credit notes', () => {
    expect(getSaleEditability({ ...manualSale, documentType: DocumentType.CREDIT_NOTE }).editable).toBe(false);
  });

  it('blocks anything with a KRA footprint even if the status looks pre-submission', () => {
    expect(getSaleEditability({ ...manualSale, submittedAt: new Date() }).editable).toBe(false);
    expect(getSaleEditability({ ...manualSale, oscuInvcNo: 12 }).editable).toBe(false);
    expect(getSaleEditability({ ...manualSale, etimsReceiptNumber: '5' }).editable).toBe(false);
  });
});
