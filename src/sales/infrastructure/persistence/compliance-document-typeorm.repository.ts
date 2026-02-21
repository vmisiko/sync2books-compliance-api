import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import type { ComplianceLine } from '../../domain/entities/compliance-line.entity';
import type { IComplianceDocumentRepository } from '../../../shared/ports/repository.port';
import { ComplianceDocumentOrmEntity } from './compliance-document.orm-entity';
import { ComplianceLineOrmEntity } from './compliance-line.orm-entity';

function lineOrmToDomain(row: ComplianceLineOrmEntity): ComplianceLine {
  return {
    id: row.id,
    documentId: row.documentId,
    itemId: row.itemId,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    taxCategory: row.taxCategory as ComplianceLine['taxCategory'],
    taxAmount: row.taxAmount,
    classificationCodeSnapshot: row.classificationCodeSnapshot,
    unitCodeSnapshot: row.unitCodeSnapshot,
    packagingUnitCodeSnapshot: ensureNullableString(
      row.packagingUnitCodeSnapshot,
    ),
    taxTyCdSnapshot: ensureNullableString(row.taxTyCdSnapshot),
    productTypeCodeSnapshot: ensureNullableString(row.productTypeCodeSnapshot),
    createdAt: row.createdAt,
  };
}

function docOrmToDomain(
  row: ComplianceDocumentOrmEntity,
  lines: ComplianceLineOrmEntity[],
): ComplianceDocument {
  return {
    id: row.id,
    merchantId: row.merchantId,
    branchId: row.branchId,
    sourceSystem: row.sourceSystem as ComplianceDocument['sourceSystem'],
    sourceDocumentId: row.sourceDocumentId,
    documentType: row.documentType as ComplianceDocument['documentType'],
    documentNumber: row.documentNumber,
    originalDocumentNumber: row.originalDocumentNumber,
    originalSaleId: row.originalSaleId,
    saleDate: row.saleDate,
    receiptTypeCode: row.receiptTypeCode,
    paymentTypeCode: row.paymentTypeCode,
    invoiceStatusCode: row.invoiceStatusCode,
    currency: row.currency,
    exchangeRate: row.exchangeRate,
    subtotalAmount: row.subtotalAmount,
    totalAmount: row.totalAmount,
    totalTax: row.totalTax,
    customerPin: row.customerPin,
    complianceStatus:
      row.complianceStatus as ComplianceDocument['complianceStatus'],
    submissionAttempts: row.submissionAttempts,
    etimsReceiptNumber: row.etimsReceiptNumber,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    lines: lines.map(lineOrmToDomain),
  };
}

function docDomainToOrm(
  document: ComplianceDocument,
): ComplianceDocumentOrmEntity {
  const e = new ComplianceDocumentOrmEntity();
  e.id = document.id;
  e.merchantId = document.merchantId;
  e.branchId = document.branchId;
  e.sourceSystem = document.sourceSystem;
  e.sourceDocumentId = document.sourceDocumentId;
  e.documentType = document.documentType;
  e.documentNumber = document.documentNumber;
  e.originalDocumentNumber = document.originalDocumentNumber;
  e.originalSaleId = document.originalSaleId;
  e.saleDate = document.saleDate;
  e.receiptTypeCode = document.receiptTypeCode;
  e.paymentTypeCode = document.paymentTypeCode;
  e.invoiceStatusCode = document.invoiceStatusCode;
  e.currency = document.currency;
  e.exchangeRate = document.exchangeRate;
  e.subtotalAmount = document.subtotalAmount;
  e.totalAmount = document.totalAmount;
  e.totalTax = document.totalTax;
  e.customerPin = document.customerPin;
  e.complianceStatus = document.complianceStatus;
  e.submissionAttempts = document.submissionAttempts;
  e.etimsReceiptNumber = document.etimsReceiptNumber;
  e.idempotencyKey = document.idempotencyKey;
  e.createdAt = document.createdAt;
  e.submittedAt = document.submittedAt;

  return e;
}

@Injectable()
export class ComplianceDocumentTypeOrmRepository implements IComplianceDocumentRepository {
  constructor(
    @InjectRepository(ComplianceDocumentOrmEntity)
    private readonly documentRepo: Repository<ComplianceDocumentOrmEntity>,
    @InjectRepository(ComplianceLineOrmEntity)
    private readonly lineRepo: Repository<ComplianceLineOrmEntity>,
  ) {}

  async save(document: ComplianceDocument): Promise<ComplianceDocument> {
    const entity = docDomainToOrm(document);
    const lineEntities = document.lines.map((l) => {
      const le = new ComplianceLineOrmEntity();
      le.id = l.id;
      le.documentId = document.id;
      le.itemId = l.itemId;
      le.description = l.description;
      le.quantity = l.quantity;
      le.unitPrice = l.unitPrice;
      le.taxCategory = l.taxCategory;
      le.taxAmount = l.taxAmount;
      le.classificationCodeSnapshot = l.classificationCodeSnapshot;
      le.unitCodeSnapshot = l.unitCodeSnapshot;
      le.packagingUnitCodeSnapshot = l.packagingUnitCodeSnapshot ?? null;
      le.taxTyCdSnapshot = l.taxTyCdSnapshot ?? null;
      le.productTypeCodeSnapshot = l.productTypeCodeSnapshot ?? null;
      le.createdAt = l.createdAt;
      le.document = entity;
      return le;
    });

    await this.documentRepo.manager.transaction(async (tx) => {
      await tx.getRepository(ComplianceDocumentOrmEntity).save(entity);
      await tx
        .getRepository(ComplianceLineOrmEntity)
        .delete({ documentId: entity.id });
      if (lineEntities.length > 0) {
        await tx.getRepository(ComplianceLineOrmEntity).save(lineEntities);
      }
    });

    const savedDoc = await this.documentRepo.findOne({
      where: { id: entity.id },
    });
    if (!savedDoc) throw new Error(`Failed to save document ${entity.id}`);
    const savedLines = await this.lineRepo.find({
      where: { documentId: entity.id },
      order: { createdAt: 'ASC' },
    });
    return docOrmToDomain(savedDoc, savedLines);
  }

  async findById(id: string): Promise<ComplianceDocument | null> {
    const row = await this.documentRepo.findOne({ where: { id } });
    if (!row) return null;
    const lines = await this.lineRepo.find({
      where: { documentId: row.id },
      order: { createdAt: 'ASC' },
    });
    return docOrmToDomain(row, lines);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ComplianceDocument | null> {
    const row = await this.documentRepo.findOne({ where: { idempotencyKey } });
    if (!row) return null;
    const lines = await this.lineRepo.find({
      where: { documentId: row.id },
      order: { createdAt: 'ASC' },
    });
    return docOrmToDomain(row, lines);
  }

  async findByMerchant(merchantId: string): Promise<ComplianceDocument[]> {
    const rows = await this.documentRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const allLines = await this.lineRepo.find({
      where: { documentId: In(ids) },
      order: { createdAt: 'ASC' },
    });

    const linesByDocId = new Map<string, ComplianceLineOrmEntity[]>();
    for (const line of allLines) {
      const list = linesByDocId.get(line.documentId) ?? [];
      list.push(line);
      linesByDocId.set(line.documentId, list);
    }

    return rows.map((row) =>
      docOrmToDomain(row, linesByDocId.get(row.id) ?? []),
    );
  }

  /**
   * Optimized page fetch (keyset pagination) for report/list endpoints.
   * - Fetches only one page of docs, then fetches all lines with a single IN query.
   *
   * Cursor semantics:
   * - `cursorId` is the last seen document id from the previous page.
   * - Ordering is (createdAt DESC, id DESC) to ensure stable pagination.
   */
  async findPageByMerchantWithLines(params: {
    merchantId: string;
    beforeId?: string;
    afterId?: string;
    startDate?: string;
    endDate?: string;
    take: number;
  }): Promise<ComplianceDocument[]> {
    const { merchantId, beforeId, afterId, startDate, endDate, take } = params;
    const qb = this.documentRepo
      .createQueryBuilder('doc')
      .where('doc.merchantId = :merchantId', { merchantId });

    // Date filters (Digitax-like): uses `saleDate` (YYYY-MM-DD) which sorts lexicographically.
    if (startDate) {
      qb.andWhere('doc.saleDate >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('doc.saleDate <= :endDate', { endDate });
    }

    if (beforeId && afterId) {
      throw new Error('Cannot use both beforeId and afterId');
    }

    if (beforeId) {
      const cursorRow = await this.documentRepo.findOne({
        where: { id: beforeId },
      });
      if (cursorRow) {
        qb.andWhere(
          '(doc.createdAt < :cursorCreatedAt OR (doc.createdAt = :cursorCreatedAt AND doc.id < :cursorId))',
          {
            cursorCreatedAt: cursorRow.createdAt,
            cursorId: cursorRow.id,
          },
        );
      }
    }

    if (afterId) {
      const cursorRow = await this.documentRepo.findOne({
        where: { id: afterId },
      });
      if (cursorRow) {
        qb.andWhere(
          '(doc.createdAt > :cursorCreatedAt OR (doc.createdAt = :cursorCreatedAt AND doc.id > :cursorId))',
          {
            cursorCreatedAt: cursorRow.createdAt,
            cursorId: cursorRow.id,
          },
        );
      }
    }

    const rows = await qb
      .orderBy('doc.createdAt', 'DESC')
      .addOrderBy('doc.id', 'DESC')
      .take(take)
      .getMany();

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const allLines = await this.lineRepo.find({
      where: { documentId: In(ids) },
      order: { createdAt: 'ASC' },
    });

    const linesByDocId = new Map<string, ComplianceLineOrmEntity[]>();
    for (const line of allLines) {
      const list = linesByDocId.get(line.documentId) ?? [];
      list.push(line);
      linesByDocId.set(line.documentId, list);
    }

    return rows.map((row) =>
      docOrmToDomain(row, linesByDocId.get(row.id) ?? []),
    );
  }
}

function ensureNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : null;
}
