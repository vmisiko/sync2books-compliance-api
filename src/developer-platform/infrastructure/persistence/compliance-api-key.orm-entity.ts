import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import type { ApiKeyScope } from '../../domain/api-key-scope.enum';
import type { ComplianceApiKeyStatus } from '../../domain/entities/compliance-api-key.entity';

@Entity('compliance_api_keys')
export class ComplianceApiKeyOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Index()
  @Column('varchar')
  applicationId!: string;

  @Column('varchar')
  environment!: ConnectionEnvironment;

  @Index()
  @Column('varchar')
  keyPrefix!: string;

  /**
   * SHA-256 of the key. Unique and indexed because authentication is a lookup
   * by this column -- there is no way to find a key from its prefix alone, by
   * design.
   */
  @Index({ unique: true })
  @Column('varchar', { length: 64 })
  keyHash!: string;

  @Column('varchar', { length: 8 })
  lastFour!: string;

  @Column('varchar', { nullable: true })
  name!: string | null;

  @Column('simple-json')
  scopes!: ApiKeyScope[];

  @Column('varchar', { default: 'active' })
  status!: ComplianceApiKeyStatus;

  @Column('datetime', { nullable: true })
  lastUsedAt!: Date | null;

  @Column('datetime', { nullable: true })
  expiresAt!: Date | null;

  @Column('varchar', { nullable: true })
  createdByUserId!: string | null;

  @Column('datetime', { nullable: true })
  revokedAt!: Date | null;

  @Column('varchar', { nullable: true })
  revokedByUserId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
