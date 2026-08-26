import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IMainApiConnectionRepository } from '../../application/ports/main-api-connection.repository.port';
import type {
  IntegrationConnectionState,
  MainApiConnection,
} from '../../domain/entities/main-api-connection.entity';
import { MainApiConnectionOrmEntity } from './main-api-connection.orm-entity';

function toDomain(e: MainApiConnectionOrmEntity): MainApiConnection {
  const integrations: Record<string, IntegrationConnectionState> = {};
  for (const [key, v] of Object.entries(e.integrations ?? {})) {
    integrations[key] = {
      connectionId: v.connectionId,
      status: v.status as IntegrationConnectionState['status'],
      reason: v.reason,
      updatedAt: v.updatedAt ? new Date(v.updatedAt) : null,
    };
  }
  return {
    id: e.id,
    complianceTenantId: e.complianceTenantId,
    mainApiApplicationId: e.mainApiApplicationId,
    mainApiApiKey: e.mainApiApiKey,
    mainApiCompanyId: e.mainApiCompanyId,
    integrations,
    webhookEndpointId: e.webhookEndpointId,
    webhookSecret: e.webhookSecret,
    lastWebhookEventId: e.lastWebhookEventId,
    // Older rows created before this column existed read back as undefined
    // until TypeORM's synchronize backfills the default -- treat that the
    // same as the documented default (true) rather than as false.
    autoUploadReceiptToSource: e.autoUploadReceiptToSource ?? true,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function toOrmIntegrations(
  integrations: MainApiConnection['integrations'],
): MainApiConnectionOrmEntity['integrations'] {
  const out: NonNullable<MainApiConnectionOrmEntity['integrations']> = {};
  for (const [key, v] of Object.entries(integrations)) {
    if (!v) continue;
    out[key] = {
      connectionId: v.connectionId,
      status: v.status,
      reason: v.reason,
      updatedAt: v.updatedAt ? v.updatedAt.toISOString() : null,
    };
  }
  return out;
}

@Injectable()
export class MainApiConnectionTypeOrmRepository implements IMainApiConnectionRepository {
  constructor(
    @InjectRepository(MainApiConnectionOrmEntity)
    private readonly repo: Repository<MainApiConnectionOrmEntity>,
  ) {}

  async findByTenantId(
    complianceTenantId: string,
  ): Promise<MainApiConnection | null> {
    const e = await this.repo.findOne({ where: { complianceTenantId } });
    return e ? toDomain(e) : null;
  }

  async save(connection: MainApiConnection): Promise<MainApiConnection> {
    const e = this.repo.create({
      id: connection.id,
      complianceTenantId: connection.complianceTenantId,
      mainApiApplicationId: connection.mainApiApplicationId,
      mainApiApiKey: connection.mainApiApiKey,
      mainApiCompanyId: connection.mainApiCompanyId,
      integrations: toOrmIntegrations(connection.integrations),
      webhookEndpointId: connection.webhookEndpointId,
      webhookSecret: connection.webhookSecret,
      lastWebhookEventId: connection.lastWebhookEventId,
      autoUploadReceiptToSource: connection.autoUploadReceiptToSource,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
