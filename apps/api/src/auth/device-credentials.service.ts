import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { DevicePlatform, DeviceRevokeReason } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DEVICE_LOCKOUT_MINUTES,
  deviceRefusalBody,
  deviceSecretHash,
  deviceVerdict,
  isCredentialId,
  keptDeviceName,
  MAX_DEVICE_FAILURES,
  MAX_DEVICE_FAILURES_PER_IP,
  newDeviceSecret,
  replacedByNew,
  stillUsableSince,
  TOO_MANY_DEVICE_SIGN_INS,
} from './device-rules.js';
import { isSuperAdmin } from './roles.js';
import { WITH_ROLES, type SessionUser } from './session-user.js';
import type { ActiveSession } from './sessions.service.js';

// Fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
// sign-in"; apps/mobile/README.md, Phase 3). A device credential is made for a signed-in user in the app (an app
// session, never while viewing as someone), one active a user per phone; its secret is given to the phone once and kept
// here only hashed. The sign-in (AuthService.deviceSignIn) trades it for an ordinary app session. The person lists and
// signs out their phones (Your Sessions); an Admin a user's (the Users page; a Super Admin's, only a Super Admin).
// Deactivating the account, a password change or a reset revokes them all (users.service.ts, auth.service.ts). The
// rules: device-rules.ts. Never the secret in the audit log: making, using, refusing and revoking are written there.

const ENTITY = 'user';

/** A phone that signs in with a fingerprint, as Your Sessions and the Users page list it. */
export interface DeviceView {
  id: string;
  deviceName: string;
  platform: DevicePlatform;
  createdAt: Date;
  /** The last fingerprint sign-in; null until the first. */
  lastUsedAt: Date | null;
}

/** The credential made for the phone: its id, and its secret this once. */
export interface NewDevice {
  id: string;
  secret: string;
}

const VIEW = { id: true, deviceName: true, platform: true, createdAt: true, lastUsedAt: true } as const;

export const APP_SESSION_ONLY = 'Fingerprint sign-in can only be turned on in the Trendlix People app.';
export const NOT_WHILE_VIEWING = 'You cannot turn on fingerprint sign-in while viewing as someone.';
const SUPER_ADMIN_ACCOUNT_ONLY = "Only a Super Admin can change a Super Admin's account.";
const NOT_ACTIVE = 'This phone does not sign in with a fingerprint any more.';

@Injectable()
export class DeviceCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Turn on: a new credential for the phone the user is signed in on in the app. The user's active one on the same phone
   * (device name and platform) is revoked ('replaced'), under their row lock so two at once can't both stay active.
   */
  async create(user: SessionUser, session: Pick<ActiveSession, 'id' | 'kind'>, phone: { deviceName: string; platform: DevicePlatform }): Promise<NewDevice> {
    if (user.viewAs) throw new ForbiddenException(NOT_WHILE_VIEWING);
    if (session.kind !== 'app') throw new ForbiddenException(APP_SESSION_ONLY);
    const deviceName = keptDeviceName(phone.deviceName, phone.platform);
    const { platform } = phone;
    const secret = newDeviceSecret();
    const now = new Date();
    const { id, replaced } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const active = await tx.deviceCredential.findMany({ where: { userId: user.id, revokedAt: null }, select: { id: true, deviceName: true, platform: true } });
      const ids = replacedByNew(active, { deviceName, platform }).map((c) => c.id);
      if (ids.length) await tx.deviceCredential.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now, revokeReason: 'replaced' } });
      const created = await tx.deviceCredential.create({
        data: { userId: user.id, deviceName, platform, secretHash: deviceSecretHash(secret), createdAt: now },
        select: { id: true },
      });
      return { id: created.id, replaced: ids };
    });
    await this.audit.record({
      userId: user.id,
      action: 'device_add',
      entityType: ENTITY,
      entityId: user.id,
      diff: { credentialId: id, deviceName, platform, sessionId: session.id, ...(replaced.length && { replaced }) },
    });
    return { id, secret };
  }

  /**
   * Refuses (429) a fingerprint sign-in once its credential, or the person's address, has been refused too often within
   * the last 15 minutes, as signing in with a password is after too many wrong ones. `ip`: the address the website saw
   * (the API is reached only from the website, so its own request's address is the website's and isn't counted).
   */
  async ensureNotLimited(credentialId: string | null, ip: string | null): Promise<void> {
    const since = new Date(Date.now() - DEVICE_LOCKOUT_MINUTES * 60_000);
    const failures = (field: 'credentialId' | 'ip', value: string) =>
      this.prisma.auditLog.count({ where: { action: 'device_login_failed', at: { gte: since }, diff: { path: [field], equals: value } } });
    const [byCredential, byIp] = await Promise.all([credentialId ? failures('credentialId', credentialId) : 0, ip ? failures('ip', ip) : 0]);
    if (byCredential >= MAX_DEVICE_FAILURES || byIp >= MAX_DEVICE_FAILURES_PER_IP) {
      throw new HttpException(TOO_MANY_DEVICE_SIGN_INS, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * The fingerprint sign-in's check: the credential `id` with `secret`, not revoked, its account active, used within the
   * last 90 days. Kept as used now and answered with its user (and roles); else refused with a 401 saying why (unknown,
   * revoked, expired), written to the audit log without the secret, and revoked when it ends now (90 days, or an account
   * deactivated). `ip`: the person's address, kept with a refusal for the limit.
   */
  async verify(id: string, secret: string, ip: string | null, now = new Date()) {
    const credentialId = isCredentialId(id) ? id : null;
    const credential = credentialId
      ? await this.prisma.deviceCredential.findUnique({ where: { id: credentialId }, include: { user: { include: WITH_ROLES } } })
      : null;
    const verdict = deviceVerdict(credential, secret, now);
    if (verdict.ok && credential) {
      // kept as used, unless it was revoked meanwhile
      const { count } = await this.prisma.deviceCredential.updateMany({ where: { id: credential.id, revokedAt: null }, data: { lastUsedAt: now } });
      if (count) return { credentialId: credential.id, user: credential.user };
    }
    const refusal = verdict.ok ? ({ reason: 'revoked', problem: 'revoked' } as const) : verdict;
    if (!verdict.ok && verdict.revoke && credential) {
      await this.prisma.deviceCredential.updateMany({ where: { id: credential.id, revokedAt: null }, data: { revokedAt: now, revokeReason: verdict.revoke } });
    }
    await this.audit.record({
      userId: null,
      action: 'device_login_failed',
      entityType: ENTITY,
      entityId: credential?.userId ?? null,
      diff: { credentialId, reason: refusal.reason, problem: refusal.problem, ...(ip && { ip }) },
    });
    throw new UnauthorizedException(deviceRefusalBody(refusal.reason));
  }

  /** The user's phones that still sign in with a fingerprint (not revoked, used within the 90 days), newest first. */
  async list(userId: string, now = new Date()): Promise<DeviceView[]> {
    const rows = await this.prisma.deviceCredential.findMany({ where: { userId, ...usable(now) }, select: VIEW, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...r, platform: r.platform as DevicePlatform }));
  }

  /** The Users page: a user's phones. */
  async listFor(userId: string): Promise<DeviceView[]> {
    if (!(await this.prisma.user.count({ where: { id: userId } }))) throw new NotFoundException('User not found.');
    return this.list(userId);
  }

  /** Your Sessions' Sign out beside a phone: one of the user's own ('signed_out'); another's is not found. */
  async revokeOwn(user: SessionUser, id: string): Promise<void> {
    const credential = await this.prisma.deviceCredential.findUnique({ where: { id }, select: { userId: true, deviceName: true, platform: true, revokedAt: true } });
    if (!credential || credential.userId !== user.id) throw new NotFoundException('Phone not found.');
    if (credential.revokedAt) return;
    const { count } = await this.prisma.deviceCredential.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'signed_out' } });
    if (count) {
      await this.audit.record({
        userId: user.id,
        action: 'device_revoke',
        entityType: ENTITY,
        entityId: user.id,
        diff: { reason: 'signed_out', credentials: [{ id, deviceName: credential.deviceName, platform: credential.platform }] },
      });
    }
  }

  /**
   * The Users page: an Admin (a Super Admin too) signs out a user's phones, all or one ('revoked'); a Super Admin's, only
   * a Super Admin (as every change to their account). Answers how many were revoked.
   */
  async revoke(actor: SessionUser, userId: string, credentialId?: string): Promise<{ revoked: number }> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: { select: { key: true } } } } } });
    if (!target) throw new NotFoundException('User not found.');
    if (isSuperAdmin({ roles: target.roles.map((r) => r.role.key as SessionUser['roles'][number]) }) && !isSuperAdmin(actor)) {
      throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    }
    const now = new Date();
    const active = await this.prisma.deviceCredential.findMany({
      where: { userId, ...usable(now), ...(credentialId && { id: credentialId }) },
      select: { id: true, deviceName: true, platform: true },
    });
    if (credentialId && !active.length) throw new NotFoundException(NOT_ACTIVE);
    if (!active.length) return { revoked: 0 };
    const reason: DeviceRevokeReason = 'revoked';
    const { count } = await this.prisma.deviceCredential.updateMany({ where: { id: { in: active.map((c) => c.id) }, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
    if (count) await this.audit.record({ userId: actor.id, action: 'device_revoke', entityType: ENTITY, entityId: userId, diff: { reason, credentials: active } });
    return { revoked: count };
  }
}

/** Credentials that still sign in at `now`: not revoked, and used (or made, when never used) within the 90 days. */
function usable(now: Date) {
  const since = stillUsableSince(now);
  return { revokedAt: null, OR: [{ lastUsedAt: { gt: since } }, { lastUsedAt: null, createdAt: { gt: since } }] };
}
