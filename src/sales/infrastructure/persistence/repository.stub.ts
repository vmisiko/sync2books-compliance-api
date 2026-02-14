import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';

const connections = new Map<string, ComplianceConnection>();

export class ConnectionRepositoryStub implements IComplianceConnectionRepository {
  async findByMerchantAndBranch(
    merchantId: string,
    branchId: string,
  ): Promise<ComplianceConnection | null> {
    const key = `${merchantId}:${branchId}`;
    return Promise.resolve(connections.get(key) ?? null);
  }
}

/** Seed stub connection data for local/testing */
export function seedStubData(): void {
  const conn: ComplianceConnection = {
    id: 'conn-1',
    merchantId: 'merchant-1',
    kraPin: 'P1234567890',
    branchId: 'branch-1',
    deviceId: 'device-1',
    environment: ConnectionEnvironment.SANDBOX,
    status: ConnectionStatus.ACTIVE,
    cmcKey: 'cmc-key-stub',
    lastCodeSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  connections.set(`${conn.merchantId}:${conn.branchId}`, conn);
}
