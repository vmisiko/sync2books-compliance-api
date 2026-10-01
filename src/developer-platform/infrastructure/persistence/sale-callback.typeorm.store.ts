import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, type Repository } from 'typeorm';
import type { ISaleCallbackStore } from '../../application/ports/sale-callback.store.port';
import type { SaleCallback } from '../../domain/sale-callback';
import { SaleCallbackOrmEntity } from './sale-callback.orm-entity';

@Injectable()
export class SaleCallbackTypeOrmStore implements ISaleCallbackStore {
  constructor(
    @InjectRepository(SaleCallbackOrmEntity)
    private readonly repo: Repository<SaleCallbackOrmEntity>,
  ) {}

  async findByDocumentId(documentId: string): Promise<SaleCallback | null> {
    return this.repo.findOne({ where: { documentId } });
  }

  async save(callback: SaleCallback): Promise<SaleCallback> {
    return this.repo.save(this.repo.create(callback));
  }

  async claim(
    documentId: string,
    outcomeKey: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    // One conditional UPDATE: whichever worker's statement lands first moves
    // nextAttemptAt past `now`, and every other worker's WHERE stops matching.
    const result = await this.repo.update(
      {
        documentId,
        outcomeKey,
        status: 'pending',
        nextAttemptAt: LessThanOrEqual(now),
      },
      { nextAttemptAt: leaseUntil },
    );
    return (result.affected ?? 0) > 0;
  }

  async findDue(now: Date, limit: number): Promise<SaleCallback[]> {
    return this.repo.find({
      where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
      order: { nextAttemptAt: 'ASC' },
      take: limit,
    });
  }
}
