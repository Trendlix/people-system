import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { assetsAccessOf, developerRolesProblem, isAssetsAccess, ROLES, type AccessStanding, type AssetsAccess, type Role } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { Prisma } from '../generated/prisma/client.js';
import { standingOf } from '../employee-access/access-state.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto, SetPasswordDto, UpdateUserDto } from './user.dto.js';

const ENTITY = 'user';

const USER = {
  id: true,
  email: true,
  isActive: true,
  assetsAccess: true,
  createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
} as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER }>;

/** A sign-in account as the API returns it: never the password hash. */
export interface UserView {
  id: string;
  email: string;
  isActive: boolean;
  roles: Role[];
  /** Their Assets access as set on the Users page (owner, 21 October 2026: "3 levels per user"). */
  assetsAccess: AssetsAccess;
  /** The Assets access in effect: a Super Admin always a manager, the CEO and Finance at least viewers (assetsAccessOf). */
  assetsAccessInEffect: AssetsAccess;
  createdAt: Date;
  /** The latest successful sign-in (with the password or the fingerprint), from the audit log. */
  lastSignInAt: Date | null;
  /** The employee this account is linked to (users.employee_id, 22 October 2026); null for an account that isn't one's. */
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
  /**
   * The access standing of an employee's account (owner, 23 October 2026: "Active - Grace - Hold - No Access"), with a
   * grace's last day; null for an account that isn't an employee's (never held). Only on one account's answer.
   */
  standing?: { standing: AccessStanding; graceUntil: string | null } | null;
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
// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers"):
// given and taken away by a Super Admin only, and held with nothing but Employee beside it.
const DEVELOPER_ROLE_ONLY = 'Only a Super Admin can give or take away the Developer role.';

/** Refuses a set of roles a developer can't hold, or a Developer role given or taken by anyone but a Super Admin. */
function checkDeveloper(actor: SessionUser, before: readonly Role[], after: readonly Role[]): void {
  if (before.includes('developer') !== after.includes('developer') && !isSuperAdmin(actor)) throw new ForbiddenException(DEVELOPER_ROLE_ONLY);
  const problem = developerRolesProblem(after);
  if (problem) throw new BadRequestException([problem]);
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every account (the View-as list), or (`only: 'other'`) only those not linked to an employee: the Users page's, the
   * employees' accounts being on their profiles' Access tab (owner, 22 October 2026: "On the employee profile").
   */
  async list(only?: 'other'): Promise<UserView[]> {
    return this.views(await this.prisma.user.findMany({ where: only === 'other' ? { employeeId: null } : {}, select: USER, orderBy: { email: 'asc' } }));
  }

  async get(id: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER });
    if (!user) throw new NotFoundException('User not found.');
    const [view, standing] = await Promise.all([this.views([user]).then((v) => v[0]), user.employee ? standingOf(this.prisma, user.employee.id) : null]);
    // an employee's account shows where its access stands (23 October 2026)
    const s = standing?.result;
    return { ...view, standing: s ? { standing: s.standing, graceUntil: s.standing === 'grace' ? s.grace!.until : null } : null };
  }

  async create(dto: CreateUserDto, actor: SessionUser): Promise<UserView> {
    const roles = inOrder(dto.roles);
    if (roles.includes('super_admin') && !isSuperAdmin(actor)) throw new ForbiddenException(SUPER_ADMIN_ROLE_ONLY);
    checkDeveloper(actor, [], roles);
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
    const after = { roles: dto.roles ? inOrder(dto.roles) : before.roles, isActive: dto.isActive ?? before.isActive, assetsAccess: dto.assetsAccess ?? before.assetsAccess };
    const diff = changes(
      { roles: before.roles, isActive: before.isActive, assetsAccess: before.assetsAccess },
      { roles: dto.roles && after.roles, isActive: dto.isActive, assetsAccess: dto.assetsAccess },
    );
    if (!isSuperAdmin(actor)) {
      if (before.roles.includes('super_admin') !== after.roles.includes('super_admin')) throw new ForbiddenException(SUPER_ADMIN_ROLE_ONLY);
      if (isSuperAdmin(before)) throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    }
    if (diff.roles) checkDeveloper(actor, before.roles, after.roles);
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
      // their Assets access (21 October 2026), audited with the rest of the change
      if (diff.assetsAccess) await tx.user.update({ where: { id }, data: { assetsAccess: after.assetsAccess } });
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
   * first; and so does their Claude connector (21 October 2026: it ends as the fingerprint does, 'revoked'). Their
   * website and app sessions stay: the Users page's End all sessions is beside it.
   */
  async setPassword(id: string, dto: SetPasswordDto, actor: SessionUser): Promise<void> {
    const user = await this.get(id);
    if (isSuperAdmin(user) && !isSuperAdmin(actor)) throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    const passwordHash = await hashPassword(dto.password);
    const { devicesRevoked, connectorsEnded } = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({ where: { id }, data: { passwordHash } });
      const { count } = await tx.deviceCredential.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'password_reset' } });
      const connectors = await tx.session.updateMany({ where: { userId: id, kind: 'connector', endedAt: null }, data: { endedAt: now, endReason: 'revoked' } });
      return { devicesRevoked: count, connectorsEnded: connectors.count };
    });
    await this.audit.record({ userId: actor.id, action: 'password_reset', entityType: ENTITY, entityId: id, diff: { devicesRevoked, ...(connectorsEnded && { connectorsEnded }) } });
  }

  private async roleRows(keys: Role[]) {
    const rows = await this.prisma.role.findMany({ where: { key: { in: keys } }, select: { id: true } });
    if (rows.length !== keys.length) throw new InternalServerErrorException('Roles are missing from the database. Run the seed.');
    return rows;
  }

  /** Adds each user's last sign-in, with one query; the linked employee comes with the user (users.employee_id). */
  private async views(users: UserRow[]): Promise<UserView[]> {
    if (!users.length) return [];
    const signIns = await this.prisma.auditLog.groupBy({
      by: ['entityId'],
      // with the password, or with the fingerprint in the app (20 October 2026)
      where: { action: { in: ['login', 'device_login'] }, entityType: ENTITY, entityId: { in: users.map((u) => u.id) } },
      _max: { at: true },
    });
    const lastSignIn = new Map(signIns.map((s) => [s.entityId, s._max.at]));
    return users.map((u) => {
      const roles = inOrder(u.roles.map((r) => r.role.key));
      const assetsAccess: AssetsAccess = isAssetsAccess(u.assetsAccess) ? u.assetsAccess : 'none';
      return {
        id: u.id,
        email: u.email,
        isActive: u.isActive,
        roles,
        assetsAccess,
        assetsAccessInEffect: assetsAccessOf({ roles, assetsAccess }),
        createdAt: u.createdAt,
        lastSignInAt: lastSignIn.get(u.id) ?? null,
        employee: u.employee ?? null,
      };
    });
  }
}
