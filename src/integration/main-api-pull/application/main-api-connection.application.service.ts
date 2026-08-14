import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MAIN_API_CONNECTION_REPO } from '../../../shared/tokens';
import type { IMainApiConnectionRepository } from './ports/main-api-connection.repository.port';
import type { MainApiConnection } from '../domain/entities/main-api-connection.entity';

export type MainApiConnectionStatus = {
  configured: boolean;
  mainApiApplicationId: string | null;
  maskedApiKey: string | null;
  hasErpConnection: boolean;
};

@Injectable()
export class MainApiConnectionApplicationService {
  constructor(
    @Inject(MAIN_API_CONNECTION_REPO)
    private readonly repo: IMainApiConnectionRepository,
  ) {}

  async upsert(
    complianceTenantId: string,
    input: {
      mainApiApplicationId: string;
      mainApiApiKey: string;
      quickbooksConnectionId?: string | null;
    },
  ): Promise<MainApiConnection> {
    const existing = await this.repo.findByTenantId(complianceTenantId);
    const now = new Date();

    return this.repo.save({
      id: existing?.id ?? randomUUID(),
      complianceTenantId,
      mainApiApplicationId: input.mainApiApplicationId,
      mainApiApiKey: input.mainApiApiKey,
      quickbooksConnectionId:
        input.quickbooksConnectionId ?? existing?.quickbooksConnectionId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getForTenant(complianceTenantId: string): Promise<MainApiConnection> {
    const connection = await this.repo.findByTenantId(complianceTenantId);
    if (!connection) {
      throw new NotFoundException(
        `No main-API connection configured for tenant ${complianceTenantId}`,
      );
    }
    return connection;
  }

  async getStatus(complianceTenantId: string): Promise<MainApiConnectionStatus> {
    const connection = await this.repo.findByTenantId(complianceTenantId);
    if (!connection) {
      return {
        configured: false,
        mainApiApplicationId: null,
        maskedApiKey: null,
        hasErpConnection: false,
      };
    }
    return {
      configured: true,
      mainApiApplicationId: connection.mainApiApplicationId,
      maskedApiKey: maskApiKey(connection.mainApiApiKey),
      hasErpConnection: Boolean(connection.quickbooksConnectionId),
    };
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '********';
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}
