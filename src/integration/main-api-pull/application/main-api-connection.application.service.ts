import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MAIN_API_CONNECTION_REPO } from '../../../shared/tokens';
import type { IMainApiConnectionRepository } from './ports/main-api-connection.repository.port';
import type {
  IntegrationConnectionState,
  MainApiConnection,
} from '../domain/entities/main-api-connection.entity';
import { MainApiPullClient } from '../infrastructure/http/main-api-pull.client';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';

/** The only connection.* events we act on — matches the main API's event catalog (see WEBHOOK_SYSTEM.md). */
const SUBSCRIBED_EVENT_TYPES = [
  'connection.created',
  'connection.connected',
  'connection.reconnected',
  'connection.disconnected',
  'connection.failed',
  'connection.deleted',
] as const;
export type ConnectionWebhookEventType = (typeof SUBSCRIBED_EVENT_TYPES)[number];

/** Cards shown on the ERP Connection page — see Sync2BooksLink's own selectable set. */
export const SUPPORTED_INTEGRATION_KEYS = [
  'quickbooks',
  'odoo',
  'microsoft-dynamics-365-business-central',
] as const;
export type SupportedIntegrationKey = (typeof SUPPORTED_INTEGRATION_KEYS)[number];

export type IntegrationStatus = {
  integrationKey: string;
  connectionId: string | null;
  /** Live status driven by inbound connection.* webhooks, not just "was a connectionId ever recorded". */
  connectionState: 'not_connected' | 'connected' | 'disconnected' | 'error';
  reason: string | null;
  updatedAt: Date | null;
};

export type MainApiConnectionStatus = {
  configured: boolean;
  mainApiApplicationId: string | null;
  maskedApiKey: string | null;
  mainApiCompanyId: string | null;
  integrations: IntegrationStatus[];
};

/** Everything the Sync2BooksLink widget needs, as documented — see link-integration.mdx. */
export type MainApiLinkCredentials = {
  apiKey: string;
  applicationId: string;
  applicationName: string;
  companyId: string;
};

@Injectable()
export class MainApiConnectionApplicationService {
  private readonly logger = new Logger(MainApiConnectionApplicationService.name);

  /**
   * Per-tenant serialization for ensureCompany(). Without this, two
   * near-simultaneous calls for the same tenant (React StrictMode's double
   * effect invocation, two browser tabs, a retried request, etc.) can both
   * read `mainApiCompanyId: null` before either write lands, and each go on
   * to create its own Company/webhook endpoint on the main API — only the
   * last writer's id survives locally, orphaning the rest remotely. This
   * chains calls per complianceTenantId so a call always observes the
   * previous call's persisted result before deciding whether to create.
   */
  private readonly ensureCompanyChains = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(MAIN_API_CONNECTION_REPO)
    private readonly repo: IMainApiConnectionRepository,
    private readonly mainApiPull: MainApiPullClient,
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  async upsert(
    complianceTenantId: string,
    input: { mainApiApplicationId: string; mainApiApiKey: string },
  ): Promise<MainApiConnection> {
    const existing = await this.repo.findByTenantId(complianceTenantId);
    const now = new Date();

    return this.repo.save({
      id: existing?.id ?? randomUUID(),
      complianceTenantId,
      mainApiApplicationId: input.mainApiApplicationId,
      mainApiApiKey: input.mainApiApiKey,
      mainApiCompanyId: existing?.mainApiCompanyId ?? null,
      integrations: existing?.integrations ?? {},
      webhookEndpointId: existing?.webhookEndpointId ?? null,
      webhookSecret: existing?.webhookSecret ?? null,
      lastWebhookEventId: existing?.lastWebhookEventId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Called after a successful Sync2BooksLink connect to remember the
   * resulting connectionId for that specific integration. Sets status to
   * 'connected' immediately rather than waiting for the connection.connected
   * webhook to arrive, since the widget already confirmed success client-side.
   */
  async recordConnection(
    complianceTenantId: string,
    integrationKey: string,
    connectionId: string,
  ): Promise<void> {
    const existing = await this.repo.findByTenantId(complianceTenantId);
    if (!existing) {
      throw new NotFoundException(
        `No main-API connection configured for tenant ${complianceTenantId}`,
      );
    }
    await this.repo.save({
      ...existing,
      integrations: {
        ...existing.integrations,
        [integrationKey]: {
          connectionId,
          status: 'connected',
          reason: null,
          updatedAt: new Date(),
        },
      },
      updatedAt: new Date(),
    });
  }

  /**
   * Auto-creates the main-API Company the first time it's needed, per the
   * documented flow (concepts/companies-and-connections.mdx: "Create a
   * company" is a discrete step using just a display name — no manual id
   * pasting). Idempotent: returns the existing one if already created.
   */
  async ensureCompany(complianceTenantId: string): Promise<MainApiConnection> {
    // Chain onto any in-flight/previous call for this tenant so concurrent
    // callers can't both observe "not created yet" — see ensureCompanyChains.
    const previous = this.ensureCompanyChains.get(complianceTenantId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.ensureCompanyLocked(complianceTenantId));
    this.ensureCompanyChains.set(complianceTenantId, run);
    try {
      return await run;
    } finally {
      if (this.ensureCompanyChains.get(complianceTenantId) === run) {
        this.ensureCompanyChains.delete(complianceTenantId);
      }
    }
  }

  private async ensureCompanyLocked(complianceTenantId: string): Promise<MainApiConnection> {
    let connection = await this.getForTenant(complianceTenantId);
    if (!connection.mainApiCompanyId) {
      const tenant = await this.organization.getTenantById(complianceTenantId);
      const name = tenant?.displayName || `Tenant ${complianceTenantId}`;
      const { company } = await this.mainApiPull.createCompany(connection.mainApiApiKey, name);
      connection = await this.repo.save({ ...connection, mainApiCompanyId: company.id, updatedAt: new Date() });
    }

    return this.ensureWebhookEndpoint(connection);
  }

  /**
   * Registers this tenant as a webhook subscriber for connection.* events —
   * idempotent, and self-heals the URL if COMPLIANCE_API_PUBLIC_URL changes
   * (e.g. a fresh ngrok tunnel in local dev). Best-effort: a registration
   * failure here must not block the connect flow, since polling still works.
   */
  private async ensureWebhookEndpoint(connection: MainApiConnection): Promise<MainApiConnection> {
    const targetUrl = this.webhookUrlFor(connection.complianceTenantId);

    try {
      if (!connection.webhookEndpointId) {
        const endpoint = await this.mainApiPull.createWebhookEndpoint(connection.mainApiApiKey, {
          name: 'Compliance Dashboard — connection status',
          url: targetUrl,
          eventTypes: [...SUBSCRIBED_EVENT_TYPES],
        });
        // Scope to "any environment" — this endpoint cares about connection
        // lifecycle regardless of which NODE_ENV the main API is deployed
        // under, not just whichever one happened to be active at registration.
        await this.mainApiPull
          .setWebhookEndpointEnvironmentToAny(connection.mainApiApiKey, endpoint.id)
          .catch((error) =>
            this.logger.warn(`Failed to widen webhook endpoint environment: ${(error as Error).message}`),
          );
        return await this.repo.save({
          ...connection,
          webhookEndpointId: endpoint.id,
          webhookSecret: endpoint.secret,
          updatedAt: new Date(),
        });
      }

      // Endpoint already registered — nothing to do unless the callback URL moved.
      return connection;
    } catch (error) {
      this.logger.warn(
        `Failed to register webhook endpoint for tenant ${connection.complianceTenantId}: ${(error as Error).message}`,
      );
      return connection;
    }
  }

  /** Re-points the registered endpoint's URL, e.g. after COMPLIANCE_API_PUBLIC_URL changes. Best-effort. */
  async resyncWebhookEndpointUrl(complianceTenantId: string): Promise<void> {
    const connection = await this.getForTenant(complianceTenantId);
    if (!connection.webhookEndpointId) return;
    const targetUrl = this.webhookUrlFor(complianceTenantId);
    try {
      await this.mainApiPull.updateWebhookEndpointUrl(
        connection.mainApiApiKey,
        connection.webhookEndpointId,
        targetUrl,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to resync webhook endpoint URL for tenant ${complianceTenantId}: ${(error as Error).message}`,
      );
    }
  }

  private webhookUrlFor(complianceTenantId: string): string {
    const base = (process.env.COMPLIANCE_API_PUBLIC_URL || 'http://localhost:3001').replace(/\/?$/, '');
    return `${base}/webhooks/main-api/connections/${complianceTenantId}`;
  }

  /**
   * Verifies and applies an inbound connection.* webhook against the
   * relevant integration's slot. Returns the outcome so the controller can
   * respond appropriately without leaking which failure occurred.
   */
  async handleInboundWebhookEvent(
    complianceTenantId: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<'ok' | 'bad_signature' | 'unknown_tenant'> {
    const connection = await this.repo.findByTenantId(complianceTenantId);
    if (!connection || !connection.webhookSecret) {
      return 'unknown_tenant';
    }

    if (!this.verifySignature(rawBody, connection.webhookSecret, signatureHeader)) {
      return 'bad_signature';
    }

    // Idempotency: the main API retries the exact same event id on delivery failure.
    if (eventId && eventId === connection.lastWebhookEventId) {
      return 'ok';
    }

    const integrationKey = (payload.integrationKey as string | undefined) ?? 'quickbooks';
    const companyId = payload.companyId as string | undefined;
    if (companyId && connection.mainApiCompanyId && companyId !== connection.mainApiCompanyId) {
      this.logger.warn(
        `Ignoring ${eventType} for tenant ${complianceTenantId}: companyId ${companyId} != ${connection.mainApiCompanyId}`,
      );
      await this.repo.save({ ...connection, lastWebhookEventId: eventId, updatedAt: new Date() });
      return 'ok';
    }

    const now = new Date();
    const current = connection.integrations[integrationKey] ?? {
      connectionId: null,
      status: null,
      reason: null,
      updatedAt: null,
    };
    let next: IntegrationConnectionState = current;

    switch (eventType as ConnectionWebhookEventType) {
      case 'connection.connected':
      case 'connection.reconnected':
        next = {
          connectionId: (payload.connectionId as string) ?? current.connectionId,
          status: 'connected',
          reason: null,
          updatedAt: now,
        };
        break;
      case 'connection.disconnected':
        next = { ...current, status: 'disconnected', reason: (payload.reason as string) ?? null, updatedAt: now };
        break;
      case 'connection.failed':
        next = { ...current, status: 'error', reason: (payload.errorMessage as string) ?? null, updatedAt: now };
        break;
      case 'connection.deleted':
        next = { connectionId: null, status: null, reason: null, updatedAt: now };
        break;
      case 'connection.created':
        // No-op: created-but-not-yet-authorized isn't a state the dashboard shows separately.
        break;
    }

    await this.repo.save({
      ...connection,
      integrations: { ...connection.integrations, [integrationKey]: next },
      lastWebhookEventId: eventId,
      updatedAt: now,
    });
    return 'ok';
  }

  private verifySignature(rawBody: Buffer, secret: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signatureHeader.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Unmasked — only for building the Sync2BooksLink widget config server-side/at request time. */
  async getLinkCredentials(complianceTenantId: string): Promise<MainApiLinkCredentials> {
    const connection = await this.ensureCompany(complianceTenantId);
    if (!connection.mainApiCompanyId) {
      throw new NotFoundException('Failed to resolve a main-API company for this tenant');
    }
    return {
      apiKey: connection.mainApiApiKey,
      applicationId: connection.mainApiApplicationId,
      applicationName: 'Sync2Books Compliance Dashboard',
      companyId: connection.mainApiCompanyId,
    };
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
    const emptyIntegrations = (): IntegrationStatus[] =>
      SUPPORTED_INTEGRATION_KEYS.map((key) => ({
        integrationKey: key,
        connectionId: null,
        connectionState: 'not_connected',
        reason: null,
        updatedAt: null,
      }));

    if (!connection) {
      return {
        configured: false,
        mainApiApplicationId: null,
        maskedApiKey: null,
        mainApiCompanyId: null,
        integrations: emptyIntegrations(),
      };
    }

    const integrations = SUPPORTED_INTEGRATION_KEYS.map((key) => {
      const state = connection.integrations[key];
      // Fall back to 'connected' when a connectionId exists but no webhook has
      // landed yet (e.g. registration failed) — presence of the id is still a
      // meaningful signal, just a less fresh one than the live status field.
      const connectionState: IntegrationStatus['connectionState'] =
        state?.status ?? (state?.connectionId ? 'connected' : 'not_connected');
      return {
        integrationKey: key,
        connectionId: state?.connectionId ?? null,
        connectionState,
        reason: state?.reason ?? null,
        updatedAt: state?.updatedAt ?? null,
      };
    });

    return {
      configured: true,
      mainApiApplicationId: connection.mainApiApplicationId,
      maskedApiKey: maskApiKey(connection.mainApiApiKey),
      mainApiCompanyId: connection.mainApiCompanyId,
      integrations,
    };
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '********';
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}
