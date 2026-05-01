import type { Test } from 'supertest';

function serviceToken(): string {
  const t = process.env.COMPLIANCE_SERVICE_TOKEN?.trim();
  return t && t.length > 0 ? t : 'e2e-compliance-service-token';
}

export function withSync2BooksM2m(
  req: Test,
  companyId: string,
  extraHeaders?: Record<string, string>,
): Test {
  let r = req
    .set('Authorization', `Bearer ${serviceToken()}`)
    .set('x-sync2books-company-id', companyId);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      r = r.set(k, v);
    }
  }
  return r;
}
