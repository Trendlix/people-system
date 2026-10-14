import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ROLES, type Role } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
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
  /** The latest successful sign-in, from the audit log. */
  lastSignInAt: Date | null;
  /** The employee whose work email is this user's email. There is no other link between the two. */
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
}

/** Roles in the usual order (employee … admin), so lists and audit entries compare the same way every time. */
function inOrder(keys: string[]): Role[] {
  return ROLES.filter((r) => keys.includes(r));
}

const isActiveAdmin = (u: { isActive: boolean; roles: Role[] }) => u.isActive && u.roles.includes('admin');

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

  async create(dto: CreateUserDto, actorId: string): Promise<UserView> {
    const roles = inOrder(dto.roles);
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
    await this.audit.record({ userId: actorId, action: 'create', entityType: ENTITY, entityId: id, diff: { email: dto.email, roles, isActive: true } });
    return this.get(id);
  }

  async update(id: string, dto: UpdateUserDto, actor: SessionUser): Promise<UserView> {
    const before = await this.get(id);
    const after = { roles: dto.roles ? inOrder(dto.roles) : before.roles, isActive: dto.isActive ?? before.isActive };
    const diff = changes({ roles: before.roles, isActive: before.isActive }, { roles: dto.roles && after.roles, isActive: dto.isActive });
    if (!Object.keys(diff).length) return before;

    if (id === actor.id) {
      if (!after.isActive) throw new ConflictException('You cannot deactivate your own account. Ask another admin to do it.');
      if (!after.roles.includes('admin')) {
        throw new ConflictException('You cannot remove your own admin role. Ask another admin to do it.');
      }
    }

    const roleRows = diff.roles ? await this.roleRows(after.roles) : [];
    await this.prisma.$transaction(async (tx) => {
      if (isActiveAdmin(before) && !isActiveAdmin(after)) {
        // One such change at a time, so two admins cannot remove each other at the same moment.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:active-admins'))`;
        const others = await tx.user.count({
          where: { id: { not: id }, isActive: true, roles: { some: { role: { key: 'admin' } } } },
        });
        if (others === 0) {
          throw new ConflictException('There must always be at least one active admin. Make another user an admin first.');
        }
      }
      if (diff.roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId: id, roleId: r.id })) });
      }
      if (diff.isActive) await tx.user.update({ where: { id }, data: { isActive: after.isActive } });
    });

    await this.audit.record({ userId: actor.id, action: 'update', entityType: ENTITY, entityId: id, diff });
    return this.get(id);
  }

  /** An admin sets a new temporary password, e.g. when someone has forgotten theirs. */
  async setPassword(id: string, dto: SetPasswordDto, actorId: string): Promise<void> {
    await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(dto.password) } });
    await this.audit.record({ userId: actorId, action: 'password_reset', entityType: ENTITY, entityId: id });
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
        where: { action: 'login', entityType: ENTITY, entityId: { in: users.map((u) => u.id) } },
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
