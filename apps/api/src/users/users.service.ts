import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ROLES, type Role } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto, SetPasswordDto, UpdateUserDto } from './user.dto.js';

const ENTITY = 'user';

const USER = {
  id: true,
  email: true,
  isActive: true,
  createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
} as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER }>;

/** A sign-in account as the API returns it: never the password hash. */
export interface UserView {
  id: string;
  email: string;
  isActive: boolean;
  roles: Role[];
  createdAt: Date;
  /** The latest successful sign-in (with the password or the fingerprint), from the audit log. */
  lastSignInAt: Date | null;
  /** The employee whose work email is this user's email. There is no other link between the two. */
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
}

/** Roles in the usual order (employee … super admin), so lists and audit entries compare the same way every time. */
function inOrder(keys: string[]): Role[] {
  return ROLES.filter((r) => keys.includes(r));
}

// A Super Admin has an Admin's powers (owner's decision, 15 October 2026), so counts as one here.
const isActiveAdmin = (u: { isActive: boolean; roles: Role[] }) => u.isActive && actsAs(u.roles, ['admin']);
const isActiveSuperAdmin = (u: { isActive: boolean; roles: Role[] }) => u.isActive && isSuperAdmin(u);

// Super Admins are protected (owner's decision, 15 October 2026): only a Super Admin gives or takes away the role, or
// changes a Super Admin's account, and there is always at least one active Super Admin.
const SUPER_ADMIN_ROLE_ONLY = 'Only a Super Admin can give or take away the Super Admin role.';
const SUPER_ADMIN_ACCOUNT_ONLY = "Only a Super Admin can change a Super Admin's account.";
const LAST_SUPER_ADMIN = 'There must always be at least one active Super Admin.';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<UserView[]> {
    return this.views(await this.prisma.user.findMany({ select: USER, orderBy: { email: 'asc' } }));
  }

  async get(id: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER });
    if (!user) throw new NotFoundException('User not found.');
    return (await this.views([user]))[0];
  }

  async create(dto: CreateUserDto, actor: SessionUser): Promise<UserView> {
    const roles = inOrder(dto.roles);
    if (roles.includes('super_admin') && !isSuperAdmin(actor)) throw new ForbiddenException(SUPER_ADMIN_ROLE_ONLY);
    const roleRows = await this.roleRows(roles);
    let id: string;
    try {
      ({ id } = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await hashPassword(dto.password),
          roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
        },
        select: { id: true },
      }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A user with this email already exists.');
      }
      throw err;
    }
    // Never the password, not even hashed.
    await this.audit.record({ userId: actor.id, action: 'create', entityType: ENTITY, entityId: id, diff: { email: dto.email, roles, isActive: true } });
    return this.get(id);
  }

  async update(id: string, dto: UpdateUserDto, actor: SessionUser): Promise<UserView> {
    const before = await this.get(id);
    const after = { roles: dto.roles ? inOrder(dto.roles) : before.roles, isActive: dto.isActive ?? before.isActive };
    const diff = changes({ roles: before.roles, isActive: before.isActive }, { roles: dto.roles && after.roles, isActive: dto.isActive });
    if (!isSuperAdmin(actor)) {
      if (before.roles.includes('super_admin') !== after.roles.includes('super_admin')) throw new ForbiddenException(SUPER_ADMIN_ROLE_ONLY);
      if (isSuperAdmin(before)) throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    }
    if (!Object.keys(diff).length) return before;

    if (id === actor.id) {
      if (!after.isActive) throw new ConflictException('You cannot deactivate your own account. Ask another admin to do it.');
      // a Super Admin keeps an Admin's powers without the admin role itself
      if (!actsAs(after.roles, ['admin'])) {
        throw new ConflictException('You cannot remove your own admin role. Ask another admin to do it.');
      }
    }

    const roleRows = diff.roles ? await this.roleRows(after.roles) : [];
    const losesSuperAdmin = isActiveSuperAdmin(before) && !isActiveSuperAdmin(after);
    const losesAdmin = isActiveAdmin(before) && !isActiveAdmin(after);
    await this.prisma.$transaction(async (tx) => {
      if (losesSuperAdmin || losesAdmin) {
        // One such change at a time, so two admins cannot remove each other at the same moment.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:active-admins'))`;
        const others = (keys: Role[]) =>
          tx.user.count({ where: { id: { not: id }, isActive: true, roles: { some: { role: { key: { in: keys } } } } } });
        if (losesSuperAdmin && (await others(['super_admin'])) === 0) throw new ConflictException(LAST_SUPER_ADMIN);
        if (losesAdmin && (await others(['admin', 'super_admin'])) === 0) {
          throw new ConflictException('There must always be at least one active admin. Make another user an admin first.');
        }
      }
      if (diff.roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId: id, roleId: r.id })) });
      }
      if (diff.isActive) await tx.user.update({ where: { id }, data: { isActive: after.isActive } });
      // deactivating signs them out at once: their open sessions end (sessions kept on the server, 20 October 2026), so
      // reactivating the account doesn't bring an old one back; nor does their phones' fingerprint sign-in (README
      // Phase 3, 20 October 2026: revoked, 'deactivated'). The update's entry records it.
      if (diff.isActive && !after.isActive) {
        const now = new Date();
        await tx.session.updateMany({ where: { userId: id, endedAt: null }, data: { endedAt: now, endReason: 'revoked' } });
        await tx.deviceCredential.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'deactivated' } });
      }
    });

    await this.audit.record({ userId: actor.id, action: 'update', entityType: ENTITY, entityId: id, diff });
    return this.get(id);
  }

  /**
   * An admin sets a new temporary password, e.g. when someone has forgotten theirs; a Super Admin's, only a Super Admin.
   * Their phones' fingerprint sign-in stops too ('password_reset'; README Phase 3, 20 October 2026): the new password
   * first. Their open sessions stay: the Users page's End all sessions is beside it.
   */
  async setPassword(id: string, dto: SetPasswordDto, actor: SessionUser): Promise<void> {
    const user = await this.get(id);
    if (isSuperAdmin(user) && !isSuperAdmin(actor)) throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    const passwordHash = await hashPassword(dto.password);
    const devicesRevoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      const { count } = await tx.deviceCredential.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_reset' } });
      return count;
    });
    await this.audit.record({ userId: actor.id, action: 'password_reset', entityType: ENTITY, entityId: id, diff: { devicesRevoked } });
  }

  private async roleRows(keys: Role[]) {
    const rows = await this.prisma.role.findMany({ where: { key: { in: keys } }, select: { id: true } });
    if (rows.length !== keys.length) throw new InternalServerErrorException('Roles are missing from the database. Run the seed.');
    return rows;
  }

  /** Adds each user's last sign-in and linked employee, with one query for each. */
  private async views(users: UserRow[]): Promise<UserView[]> {
    if (!users.length) return [];
    const [signIns, employees] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['entityId'],
        // with the password, or with the fingerprint in the app (20 October 2026)
        where: { action: { in: ['login', 'device_login'] }, entityType: ENTITY, entityId: { in: users.map((u) => u.id) } },
        _max: { at: true },
      }),
      this.prisma.employee.findMany({
        where: { workEmail: { in: users.map((u) => u.email) } },
        select: { id: true, employeeCode: true, fullNameEn: true, workEmail: true },
      }),
    ]);
    const lastSignIn = new Map(signIns.map((s) => [s.entityId, s._max.at]));
    const employeeByEmail = new Map(employees.map(({ workEmail, ...e }) => [workEmail, e]));
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      isActive: u.isActive,
      roles: inOrder(u.roles.map((r) => r.role.key)),
      createdAt: u.createdAt,
      lastSignInAt: lastSignIn.get(u.id) ?? null,
      employee: employeeByEmail.get(u.email) ?? null,
    }));
  }
}
