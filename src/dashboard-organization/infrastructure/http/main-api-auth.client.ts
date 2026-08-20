import { Injectable, Logger, BadGatewayException } from '@nestjs/common';

/**
 * Server-to-server calls against the main API's *unauthenticated* self-serve
 * signup surface (auth/signup, organizations/:id/applications) — distinct
 * from MainApiPullClient, which is entirely apiKey-authenticated partner
 * calls. Used once, at dashboard-organization signup time, to auto-provision
 * the main-API Organization + Application that MainApiConnectionApplicationService
 * needs, instead of a human pasting an apiKey into a settings page.
 */
export interface MainApiSignupResult {
  organizationId: string;
}

export interface MainApiApplicationResult {
  applicationId: string;
  apiKey: string;
}

@Injectable()
export class MainApiAuthClient {
  private readonly logger = new Logger(MainApiAuthClient.name);

  private baseUrl(): string {
    const base = process.env.MAIN_API_BASE_URL?.trim();
    if (!base) {
      throw new BadGatewayException('MAIN_API_BASE_URL is not configured');
    }
    return base.replace(/\/?$/, '');
  }

  async signUp(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    organizationName: string;
  }): Promise<MainApiSignupResult> {
    const body = await this.postJson<{
      data: { organization: { id: string } };
    }>('/auth/signup', {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      password: input.password,
      organizationName: input.organizationName,
      acceptTerms: true,
    });
    return { organizationId: body.data.organization.id };
  }

  /**
   * Mints an Application (and its apiKey) under a freshly-signed-up
   * Organization. The main API's own createApplication response returns TWO
   * credentials (development + production, one apiKey each) — production is
   * what every subsequent Company/eTIMS call should use.
   */
  async createApplication(
    organizationId: string,
    name: string,
  ): Promise<MainApiApplicationResult> {
    const body = await this.postJson<{
      id: string;
      credentials?: Array<{ environment: string; apiKey: string }>;
    }>(`/organizations/${organizationId}/applications`, {
      name,
      // Required by the main API's CreateApplicationDto (WEB|MOBILE|DESKTOP|SERVER,
      // no default) — this Application exists only to hold the apiKey the
      // compliance dashboard uses server-to-server, closest fit is SERVER.
      type: 'SERVER',
    });

    const production = body.credentials?.find(
      (c) => c.environment === 'production',
    );
    const fallback = body.credentials?.[0];
    const apiKey = production?.apiKey ?? fallback?.apiKey;
    if (!apiKey) {
      throw new BadGatewayException(
        'Main API did not return an application apiKey',
      );
    }
    return { applicationId: body.id, apiKey };
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }
}
