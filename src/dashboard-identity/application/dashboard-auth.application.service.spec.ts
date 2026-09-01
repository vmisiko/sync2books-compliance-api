import { JwtService } from '@nestjs/jwt';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DashboardAuthApplicationService } from './dashboard-auth.application.service';
import type { DashboardUser } from '../domain/entities/dashboard-user.entity';
import { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';

function makeUsersRepo(seed: DashboardUser[] = []) {
  const store = new Map(seed.map((u) => [u.email, u]));
  return {
    findById: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve([...store.values()].find((u) => u.id === id) ?? null),
      ),
    findByEmail: jest
      .fn()
      .mockImplementation((email: string) =>
        Promise.resolve(store.get(email) ?? null),
      ),
    listByOrganizationId: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation((user: DashboardUser) => {
      store.set(user.email, user);
      return Promise.resolve(user);
    }),
    _store: store,
  };
}

describe('DashboardAuthApplicationService invite flow', () => {
  const organization = { id: 'org-1', displayName: 'Acme Ltd' };
  const organizations = {
    getById: jest.fn().mockResolvedValue(organization),
    create: jest.fn(),
  };

  function makeService(usersRepo = makeUsersRepo()) {
    const jwt = new JwtService({ secret: 'test-secret' });
    const service = new DashboardAuthApplicationService(
      usersRepo as any,
      jwt,
      organizations as any,
    );
    return { service, usersRepo, jwt };
  }

  beforeEach(() => {
    organizations.getById.mockClear();
  });

  it('createInvite issues a link containing a #token fragment, not a query string', async () => {
    const { service } = makeService();

    const result = await service.createInvite({
      email: 'PETER@Company.co.ke',
      displayName: 'Peter Otieno',
      role: DashboardRole.ACCOUNTANT,
      organizationId: 'org-1',
    });

    expect(result.email).toBe('peter@company.co.ke');
    expect(result.inviteUrl).toContain('#token=');
    expect(result.inviteUrl).not.toContain('?token=');
    expect(result.inviteToken).toBeTruthy();
  });

  it('createInvite rejects an email that already has an account', async () => {
    const existing: DashboardUser = {
      id: 'user-1',
      email: 'peter@company.co.ke',
      passwordHash: 'hash',
      displayName: 'Peter',
      role: DashboardRole.ACCOUNTANT,
      organizationId: 'org-1',
      status: 'active',
      oauthProvider: null,
      oauthSubject: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service } = makeService(makeUsersRepo([existing]));

    await expect(
      service.createInvite({
        email: 'peter@company.co.ke',
        displayName: 'Peter',
        role: DashboardRole.ACCOUNTANT,
        organizationId: 'org-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('getInvitePreview returns email/role/org without creating anything', async () => {
    const { service, usersRepo } = makeService();
    const invite = await service.createInvite({
      email: 'peter@company.co.ke',
      displayName: 'Peter Otieno',
      role: DashboardRole.CFO,
      organizationId: 'org-1',
    });

    const preview = await service.getInvitePreview(invite.inviteToken);

    expect(preview).toEqual({
      email: 'peter@company.co.ke',
      displayName: 'Peter Otieno',
      role: DashboardRole.CFO,
      organizationName: 'Acme Ltd',
    });
    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  it('getInvitePreview rejects a garbage/expired token with 404, not 401 -- 401 would trip the dashboard client\'s global redirect-to-login interceptor before the invite page can show its own error', async () => {
    const { service } = makeService();
    await expect(service.getInvitePreview('not-a-real-token')).rejects.toThrow(
      NotFoundException,
    );
  });

  it("acceptInvite creates the user with the inviter's role/org and logs them in", async () => {
    const { service, usersRepo } = makeService();
    const invite = await service.createInvite({
      email: 'peter@company.co.ke',
      displayName: 'Peter Otieno',
      role: DashboardRole.ACCOUNTANT,
      organizationId: 'org-1',
    });

    const result = await service.acceptInvite(
      invite.inviteToken,
      'SecurePass123',
    );

    expect(result.user.email).toBe('peter@company.co.ke');
    expect(result.user.role).toBe(DashboardRole.ACCOUNTANT);
    expect(result.user.organizationId).toBe('org-1');
    expect(result.tokens.accessToken).toBeTruthy();
    expect(usersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'peter@company.co.ke',
        status: 'active',
      }),
    );
  });

  it('acceptInvite rejects a token whose email was already claimed since it was issued', async () => {
    const usersRepo = makeUsersRepo();
    const { service } = makeService(usersRepo);
    const invite = await service.createInvite({
      email: 'peter@company.co.ke',
      displayName: 'Peter Otieno',
      role: DashboardRole.ACCOUNTANT,
      organizationId: 'org-1',
    });

    // Someone else claims the email (e.g. self-signup) between invite and accept.
    usersRepo._store.set('peter@company.co.ke', {
      id: 'user-2',
      email: 'peter@company.co.ke',
      passwordHash: 'hash',
      displayName: null,
      role: DashboardRole.ADMIN,
      organizationId: 'org-2',
      status: 'active',
      oauthProvider: null,
      oauthSubject: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.acceptInvite(invite.inviteToken, 'SecurePass123'),
    ).rejects.toThrow(ConflictException);
  });

  it('acceptInvite rejects a plain OAuth ticket or other non-invite JWT', async () => {
    const { service, jwt } = makeService();
    const foreignTicket = jwt.sign({ type: 'oauth_ticket', email: 'x@y.com' });

    await expect(
      service.acceptInvite(foreignTicket, 'SecurePass123'),
    ).rejects.toThrow(NotFoundException);
  });
});
