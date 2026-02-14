import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ComplianceEvent } from '../../domain/entities/compliance-event.entity';
import type { IComplianceEventRepository } from '../../../shared/ports/repository.port';
import { ComplianceEventOrmEntity } from './compliance-event.orm-entity';

function ormToDomain(row: ComplianceEventOrmEntity): ComplianceEvent {
  return {
    id: row.id,
    documentId: row.documentId,
    eventType: row.eventType as ComplianceEvent['eventType'],
    payloadSnapshot: row.payloadSnapshot,
    responseSnapshot: row.responseSnapshot,
    createdAt: row.createdAt,
  };
}

function domainToOrm(event: ComplianceEvent): ComplianceEventOrmEntity {
  const e = new ComplianceEventOrmEntity();
  e.id = event.id;
  e.documentId = event.documentId;
  e.eventType = event.eventType;
  e.payloadSnapshot = event.payloadSnapshot;
  e.responseSnapshot = event.responseSnapshot;
  e.createdAt = event.createdAt;
  return e;
}

@Injectable()
export class ComplianceEventTypeOrmRepository implements IComplianceEventRepository {
  constructor(
    @InjectRepository(ComplianceEventOrmEntity)
    private readonly repo: Repository<ComplianceEventOrmEntity>,
  ) {}

  async append(event: ComplianceEvent): Promise<ComplianceEvent> {
    const saved = await this.repo.save(domainToOrm(event));
    return ormToDomain(saved);
  }

  async findByDocumentId(documentId: string): Promise<ComplianceEvent[]> {
    const rows = await this.repo.find({
      where: { documentId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(ormToDomain);
  }
}
