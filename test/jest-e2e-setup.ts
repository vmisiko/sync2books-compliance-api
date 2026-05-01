/**
 * Default M2M token for e2e when the environment does not set one.
 * Guard enforcement is enabled whenever `COMPLIANCE_SERVICE_TOKEN` is non-empty.
 */
process.env.COMPLIANCE_SERVICE_TOKEN =
  process.env.COMPLIANCE_SERVICE_TOKEN?.trim() || 'e2e-compliance-service-token';
