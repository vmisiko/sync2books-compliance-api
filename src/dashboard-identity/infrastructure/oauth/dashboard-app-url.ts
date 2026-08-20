/** Where the compliance dashboard frontend lives -- OAuth callbacks redirect here after Google/Microsoft hands control back to us. Defaults to match COMPLIANCE_DASHBOARD_ORIGINS' own default in main.ts. */
export function dashboardAppUrl(): string {
  return (process.env.DASHBOARD_APP_URL || 'http://localhost:3002')
    .trim()
    .replace(/\/+$/, '');
}
