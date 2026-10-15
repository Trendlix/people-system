import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_HOURS, type Me, type SessionUser } from './session-user.js';

const INVALID = 'Invalid email or password.';

// Failed sign-ins allowed per email within the window before further attempts are refused.
export const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  // Compared against when the email is unknown, so both cases take about the same time.
  private readonly dummyHash = hashPassword('not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const normalized = email.trim().toLowerCase();
    await this.ensureNotLockedOut(normalized);
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { roles: { include: { role: true } } },
    });

    let ok = false;
    if (user?.passwordHash) ok = await verifyPassword(password, user.passwordHash);
    else await verifyPassword(password, await this.dummyHash);

    if (!user || !ok || !user.isActive) {
      await this.audit.record({
        userId: null,
        action: 'login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        diff: { email: normalized },
      });
      throw new UnauthorizedException(INVALID);
    }

    await this.audit.record({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id });
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: `${SESSION_HOURS}h` });
    return {
      token,
      user: { id: user.id, email: user.email, roles: user.roles.map((r) => r.role.key as Role) },
    };
  }

  /** The signed-in user and the id of their own employee profile, if they have one. */
  async me(user: SessionUser): Promise<Me> {
    const own = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    return { ...user, employeeId: own?.id ?? null };
  }

  /** A signed-in person changes their own password; the current one is asked for again. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    const ok = user.passwordHash ? await verifyPassword(currentPassword, user.passwordHash) : false;
    if (!ok) throw new BadRequestException('Your current password is not correct.');
    if (newPassword === currentPassword) {
      throw new BadRequestException('Choose a new password that is different from your current one.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await this.audit.record({ userId, action: 'password_change', entityType: 'user', entityId: userId });
  }

  private async ensureNotLockedOut(email: string): Promise<void> {
    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const failures = await this.prisma.auditLog.count({
      where: { action: 'login_failed', at: { gte: since }, diff: { path: ['email'], equals: email } },
    });
    if (failures >= MAX_FAILED_LOGINS) {
      throw new HttpException(
        `Too many failed sign-in attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
