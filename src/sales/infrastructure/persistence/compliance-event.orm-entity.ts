import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ComplianceDocumentOrmEntity } from './compliance-document.orm-entity';

@Entity('compliance_events')
export class ComplianceEventOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @ManyToOne(() => ComplianceDocumentOrmEntity, { onDelete: 'CASCADE' })
  document!: ComplianceDocumentOrmEntity;

  @Column('varchar')
  @Index()
  documentId!: string;

  @Column('varchar')
  eventType!: string;

  @Column('simple-json', { nullable: true })
  payloadSnapshot!: Record<string, unknown> | null;

  @Column('simple-json', { nullable: true })
  responseSnapshot!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
