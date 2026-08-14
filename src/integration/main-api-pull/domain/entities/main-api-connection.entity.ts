/**
 * Per-tenant credentials for compliance-api pulling Items/Invoices from the
 * main Sync2Books API (compliance-dashboard registered as its own Application
 * there — see THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md).
 *
 * `apiKey` is stored in plain text, consistent with how the main API itself
 * stores QuickBooks OAuth tokens today (ConnectionEntity.accessToken) — no
 * field-level encryption exists anywhere in either service yet. Flagging this
 * as a known gap rather than silently introducing a one-off crypto scheme.
 */
/** Mirrors the main API's own connection.* webhook lifecycle — see WEBHOOK_SYSTEM.md. */
export type IntegrationConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error';

/** Live status of one accounting-tool connection, kept current by inbound webhooks. */
export interface IntegrationConnectionState {
  connectionId: string | null;
  status: IntegrationConnectionStatus | null;
  /** disconnect reason / error message from the most recent webhook, for troubleshooting. */
  reason: string | null;
  updatedAt: Date | null;
}

export interface MainApiConnection {
  id: string;
  complianceTenantId: string;
  mainApiApplicationId: string;
  mainApiApiKey: string;
  /** The main API's own Company.id — required to drive the Sync2BooksLink connect widget. */
  mainApiCompanyId: string | null;
  /**
   * One entry per accounting tool the widget can connect (quickbooks, odoo,
   * microsoft-dynamics-365-business-central, ...) — a company can hold
   * multiple simultaneous connections, so this isn't a single field.
   */
  integrations: Partial<Record<string, IntegrationConnectionState>>;
  /** This tenant's registered main-API webhook endpoint (id + secret), for verifying inbound events. */
  webhookEndpointId: string | null;
  webhookSecret: string | null;
  /** Last processed X-Webhook-Event-ID, for idempotency against delivery retries. */
  lastWebhookEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
