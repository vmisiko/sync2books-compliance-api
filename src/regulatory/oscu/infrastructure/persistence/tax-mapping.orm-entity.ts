import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SourceSystem } from '../../../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../../../shared/domain/enums/mapping-status.enum';

@Entity('tax_mappings')
@Index(['merchantId', 'internalTaxCategory', 'active'], { unique: true })
export class TaxMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  /** Null for a pulled external rate with no confident auto-suggestion (status UNMAPPED) — a human fills this in via PATCH dashboard-api/mappings/:id. */
  @Column('varchar', { nullable: true })
  internalTaxCategory!: string | null;

  /** Null alongside internalTaxCategory for the same UNMAPPED reason. */
  @Column('varchar', { nullable: true })
  taxTyCd!: string | null;

  @Column('int', { default: 1 })
  version!: number;

  @Column('boolean', { default: true })
  active!: boolean;

  // --- Mapping Center dashboard fields (additive; unused by
  // ClassificationResolverTypeOrm, which only reads the columns above) ---

  /** Which ERP this row's suggestion/value came from; null for global defaults and pre-existing rows. */
  @Column('varchar', { nullable: true })
  sourceSystem!: SourceSystem | null;

  /** Review-workflow status. Existing global-default rows default to MAPPED (they are already in effect). */
  @Column('varchar', { default: MappingStatus.MAPPED })
  status!: MappingStatus;

  /** 0-100 auto-suggestion confidence; null for manually-entered or pre-existing rows. */
  @Column('int', { nullable: true })
  confidenceScore!: number | null;

  /** Dashboard user (email) who approved/edited this mapping. */
  @Column('varchar', { nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  /** Raw label as it appeared in the source system, e.g. "16% Standard VAT". */
  @Column('varchar', { nullable: true })
  externalValue!: string | null;

  /** The source system's raw id for this row (e.g. a QuickBooks TaxRate id) — lets a re-pull find and refresh this exact row (including an UNMAPPED one) instead of creating a duplicate. Null for manually-created rows. */
  @Column('varchar', { nullable: true })
  externalId!: string | null;

  // --- QuickBooks TaxCode fields (additive; see MainApiTaxCode in
  // main-api-pull.client.ts) ---
  //
  // The fields above this block are all derived from QuickBooks' TaxRate
  // entity, which is NOT assignable to a transaction line — QuickBooks'
  // SalesItemLineDetail.TaxCodeRef needs a TaxCode id, a separate entity
  // that wraps one-or-more TaxRates. taxCodeId is therefore the field that
  // actually represents "what would get written to a QuickBooks
  // transaction"; internalTaxCategory/taxTyCd/externalValue above stay as
  // supporting/reporting detail (the percentage detail lives on TaxRate,
  // not TaxCode) rather than being replaced.
  //
  // Kept as three separate columns rather than reusing confidenceScore/
  // externalValue above, because a single tax_mappings row is keyed by
  // (merchantId, internalTaxCategory) — and several QuickBooks TaxCodes can
  // legitimately map to the same broad KRA category (e.g. "16.0% S",
  // "16.0% S Import", "16.0% S - RC Imported Services" are all
  // VAT_STANDARD). Only one taxCodeId can live on this row, so
  // taxCodeConfidenceScore lets the upsert path keep whichever pulled
  // TaxCode scored highest for this category rather than just last-write-
  // wins, without disturbing the TaxRate-derived confidenceScore semantics
  // that already existed.

  /** The QuickBooks TaxCode id to actually write onto a transaction line's TaxCodeRef — null until a TaxCode pull resolves one. */
  @Column('varchar', { nullable: true })
  taxCodeId!: string | null;

  /** Raw TaxCode name as pulled from the main API, e.g. "16.0% S", "Exempt Sale", "No VAT". */
  @Column('varchar', { nullable: true })
  taxCodeExternalValue!: string | null;

  /** 0-100 confidence for taxCodeId specifically (independent of confidenceScore above) — see the block comment for why this needs its own score. */
  @Column('int', { nullable: true })
  taxCodeConfidenceScore!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
