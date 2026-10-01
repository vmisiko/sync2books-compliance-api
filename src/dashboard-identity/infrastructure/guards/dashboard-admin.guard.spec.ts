import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';
import { DashboardAdminGuard } from './dashboard-admin.guard';

const ORG = 'org-A';

function context(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(row: Record<string, unknown> | null) {
  const users = { findById: jest.fn(async () => row) };
  return { guard: new DashboardAdminGuard(users as never), users };
}

const admin = {
  id: 'user-1',
  organizationId: ORG,
  role: DashboardRole.ADMIN,
  status: 'active',
};
const caller = { userId: 'user-1', organizationId: ORG, role: 'admin' };

describe('DashboardAdminGuard', () => {
  it('lets an active admin of the organisation through', async () => {
    const { guard } = guardWith(admin);
    await expect(guard.canActivate(context(caller))).resolves.toBe(true);
  });

  it.each([DashboardRole.ACCOUNTANT, DashboardRole.CFO])(
    'refuses a %s',
    async (role) => {
      const { guard } = guardWith({ ...admin, role });
      await expect(guard.canActivate(context(caller))).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  // The JWT still says admin; the row is what counts.
  it('refuses an admin demoted since their token was issued', async () => {
    const { guard } = guardWith({ ...admin, role: DashboardRole.ACCOUNTANT });
    await expect(
      guard.canActivate(context({ ...caller, role: 'admin' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a deactivated admin', async () => {
    const { guard } = guardWith({ ...admin, status: 'deactivated' });
    await expect(guard.canActivate(context(caller))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a token whose organisation no longer matches the user', async () => {
    const { guard } = guardWith({ ...admin, organizationId: 'org-B' });
    await expect(guard.canActivate(context(caller))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a user that no longer exists', async () => {
    const { guard } = guardWith(null);
    await expect(guard.canActivate(context(caller))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a request with no signed-in user', async () => {
    const { guard, users } = guardWith(admin);
    await expect(guard.canActivate(context(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(users.findById).not.toHaveBeenCalled();
  });
});
