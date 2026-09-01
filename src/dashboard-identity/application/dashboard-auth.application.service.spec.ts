import { JwtService } from '@nestjs/jwt';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DashboardAuthApplicationService } from './dashboard-auth.application.service';
import type { DashboardUser } from '../domain/entities/dashboard-user.entity';
import { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';

function makeUser(overrides: Partial<DashboardUser> = {}): DashboardUser {
  return {
    id: 'user-1',
    email: 'peter@company.co.ke',
    passwordHash: 'hash',
    displayName: 'Peter Otieno',
    role: DashboardRole.ACCOUNTANT,
    organizationId: 'org-1',
    status: 'active',
    oauthProvider: null,
    oauthSubject: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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
    listByOrganizationId: jest
      .fn()
      .mockImplementation((organizationId: string) =>
        Promise.resolve(
          [...store.values()].filter(
            (u) => u.organizationId === organizationId,
          ),
        ),
      ),
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

describe('DashboardAuthApplicationService password reset flow', () => {
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

  it("createPasswordReset issues a link containing a #token fragment, not a query string", async () => {
    const member = makeUser();
    const { service } = makeService(makeUsersRepo([member]));

    const reset = await service.createPasswordReset('org-1', member.id);

    expect(reset.email).toBe(member.email);
    expect(reset.resetUrl).toContain('#token=');
    expect(reset.resetUrl).not.toContain('?token=');
    expect(reset.resetToken).toBeTruthy();
  });

  it('createPasswordReset 404s for a member outside the caller\'s organization', async () => {
    const member = makeUser({ organizationId: 'org-2' });
    const { service } = makeService(makeUsersRepo([member]));

    await expect(
      service.createPasswordReset('org-1', member.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('createPasswordReset rejects a deactivated member', async () => {
    const member = makeUser({ status: 'deactivated' });
    const { service } = makeService(makeUsersRepo([member]));

    await expect(
      service.createPasswordReset('org-1', member.id),
    ).rejects.toThrow(ConflictException);
  });

  it('getPasswordResetPreview returns who the link is for without changing anything', async () => {
    const member = makeUser();
    const { service, usersRepo } = makeService(makeUsersRepo([member]));
    const reset = await service.createPasswordReset('org-1', member.id);

    const preview = await service.getPasswordResetPreview(reset.resetToken);

    expect(preview).toEqual({
      email: member.email,
      displayName: member.displayName,
      organizationName: 'Acme Ltd',
    });
    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  it('getPasswordResetPreview rejects a garbage/expired token with 404, not 401', async () => {
    const { service } = makeService();
    await expect(
      service.getPasswordResetPreview('not-a-real-token'),
    ).rejects.toThrow(NotFoundException);
  });

  it('resetPassword sets a new password hash and logs the member straight in', async () => {
    const member = makeUser();
    const { service, usersRepo } = makeService(makeUsersRepo([member]));
    const reset = await service.createPasswordReset('org-1', member.id);

    const result = await service.resetPassword(
      reset.resetToken,
      'BrandNewPass123',
    );

    expect(result.user.email).toBe(member.email);
    expect(result.tokens.accessToken).toBeTruthy();
    expect(usersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: member.id,
        passwordHash: expect.not.stringMatching('hash'),
      }),
    );
  });

  it('resetPassword rejects a token for a member deactivated since the link was issued', async () => {
    const member = makeUser();
    const usersRepo = makeUsersRepo([member]);
    const { service } = makeService(usersRepo);
    const reset = await service.createPasswordReset('org-1', member.id);

    usersRepo._store.set(member.email, { ...member, status: 'deactivated' });

    await expect(
      service.resetPassword(reset.resetToken, 'BrandNewPass123'),
    ).rejects.toThrow(ConflictException);
  });

  it('resetPassword rejects a plain invite ticket or other non-reset JWT', async () => {
    const { service, jwt } = makeService();
    const foreignTicket = jwt.sign({ type: 'member_invite', email: 'x@y.com' });

    await expect(
      service.resetPassword(foreignTicket, 'BrandNewPass123'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DashboardAuthApplicationService updateMember deactivation guards', () => {
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

  it('rejects deactivating your own account', async () => {
    const caller = makeUser({ id: 'caller-1', role: DashboardRole.ADMIN });
    const { service } = makeService(makeUsersRepo([caller]));

    await expect(
      service.updateMember('org-1', caller.id, caller.id, {
        status: 'deactivated',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects deactivating the last active admin', async () => {
    const admin = makeUser({
      id: 'admin-1',
      email: 'admin@company.co.ke',
      role: DashboardRole.ADMIN,
    });
    const caller = makeUser({
      id: 'caller-1',
      email: 'caller@company.co.ke',
      role: DashboardRole.ACCOUNTANT,
    });
    const { service } = makeService(makeUsersRepo([admin, caller]));

    await expect(
      service.updateMember('org-1', caller.id, admin.id, {
        status: 'deactivated',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows deactivating an admin when another active admin remains', async () => {
    const admin1 = makeUser({
      id: 'admin-1',
      email: 'admin1@company.co.ke',
      role: DashboardRole.ADMIN,
    });
    const admin2 = makeUser({
      id: 'admin-2',
      email: 'admin2@company.co.ke',
      role: DashboardRole.ADMIN,
    });
    const { service, usersRepo } = makeService(makeUsersRepo([admin1, admin2]));

    const updated = await service.updateMember('org-1', admin2.id, admin1.id, {
      status: 'deactivated',
    });

    expect(updated.status).toBe('deactivated');
    expect(usersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: admin1.id, status: 'deactivated' }),
    );
  });

  it('allows deactivating a non-admin regardless of admin count', async () => {
    const admin = makeUser({
      id: 'admin-1',
      email: 'admin@company.co.ke',
      role: DashboardRole.ADMIN,
    });
    const accountant = makeUser({
      id: 'accountant-1',
      email: 'accountant@company.co.ke',
      role: DashboardRole.ACCOUNTANT,
    });
    const { service } = makeService(makeUsersRepo([admin, accountant]));

    const updated = await service.updateMember(
      'org-1',
      admin.id,
      accountant.id,
      { status: 'deactivated' },
    );

    expect(updated.status).toBe('deactivated');
  });

  it('reactivating does not trigger the self/last-admin guards', async () => {
    const admin = makeUser({
      id: 'admin-1',
      role: DashboardRole.ADMIN,
      status: 'deactivated',
    });
    const { service, usersRepo } = makeService(makeUsersRepo([admin]));

    const updated = await service.updateMember('org-1', admin.id, admin.id, {
      status: 'active',
    });

    expect(updated.status).toBe('active');
    expect(usersRepo.save).toHaveBeenCalled();
  });
});
