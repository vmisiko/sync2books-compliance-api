import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ComplianceDocumentOrmEntity } from './compliance-document.orm-entity';

@Entity('compliance_lines')
export class ComplianceLineOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @ManyToOne(() => ComplianceDocumentOrmEntity, { onDelete: 'CASCADE' })
  document!: ComplianceDocumentOrmEntity;

  @Column('varchar')
  documentId!: string;

  @Column('varchar')
  itemId!: string;

  @Column('varchar')
  description!: string;

  @Column('float')
  quantity!: number;

  @Column('float')
  unitPrice!: number;

  @Column('varchar')
  taxCategory!: string;

  @Column('float')
  taxAmount!: number;

  @Column('varchar')
  classificationCodeSnapshot!: string;

  @Column('varchar')
  unitCodeSnapshot!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
