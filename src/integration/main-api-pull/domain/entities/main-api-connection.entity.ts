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
export interface MainApiConnection {
  id: string;
  complianceTenantId: string;
  mainApiApplicationId: string;
  mainApiApiKey: string;
  /** Set once QuickBooks (or another ERP) has been connected to that Application on the main API. */
  quickbooksConnectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
