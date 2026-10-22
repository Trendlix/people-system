import { applyDecorators, CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ASSETS_REFUSALS, assetsAccessAtLeast, assetsAccessOf, assetsCan, seesAssetValues, type AssetsAccess, type AssetsAccessView } from '@trendlix/shared';
import type { SessionRequest } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Who may do what in Assets (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"; "3 levels per user"; values: "CEO and Finance"). Not a role: each user's Assets access, set on the Users page
// (users.assets_access), read from the database on every request as the roles are, so a change applies at once; while a
// Super Admin views as someone, it is that user's. The level in effect (packages/shared assetsAccessOf): a Super Admin
// is always a manager; the CEO and Finance at least viewers, as they fill the values; everyone else the level set. Every
// route of the module names the level it needs (@AssetsLevel), checked here after the sign-in (AuthGuard), with 403 in
// words below it; the values are apart (@AssetValues, or the services' own check): the CEO, Finance and a Super Admin
// only, whatever their level, and the services leave them out of every answer to anyone else.

/** The caller in Assets: their session, the level in effect and whether they see the values. */
export interface AssetsCaller {
  user: SessionUser;
  access: AssetsAccess;
  values: boolean;
}

const LEVEL = 'assetsLevel';
const VALUES = 'assetValues';
const SETTINGS = 'assetSettings';

type AssetsRequest = SessionRequest & { assets?: AssetsCaller };

/** The caller's Assets access in effect and the values rule, read from the database (their level as set). */
export async function assetsCallerOf(prisma: PrismaService, user: SessionUser): Promise<AssetsCaller> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { assetsAccess: true } });
  // a developer sees every asset as a manager would, never their values (owner, 22 October 2026: "Money … hidden")
  return { user, access: assetsAccessOf({ roles: user.roles, assetsAccess: row?.assetsAccess }), values: !user.developer && seesAssetValues(user) };
}

/**
 * GET /auth/me's `assets`. `ai`: the Claude connector (step 2; owner, 21 October 2026: "the connection method") is
 * offered to them: anyone with Assets access (it reads at their level and drafts for a custodian or manager).
 */
export const assetsMe = (caller: Pick<AssetsCaller, 'access' | 'values'>): AssetsAccessView => ({ access: caller.access, values: caller.values, ai: caller.access !== 'none' });

/** Why the caller can't, or null when they can: no access at all first, then the level, then the values. */
export function assetsRefusal(caller: Pick<AssetsCaller, 'access' | 'values'>, need: { level: AssetsAccess; values?: boolean; settings?: boolean }): string | null {
  if (caller.access === 'none') return ASSETS_REFUSALS.none;
  if (need.settings) return assetsCan({ ...caller, ai: false }).settings ? null : ASSETS_REFUSALS.settings;
  if (!assetsAccessAtLeast(caller.access, need.level)) return need.level === 'manager' ? ASSETS_REFUSALS.manager : ASSETS_REFUSALS.custodian;
  if (need.values && !caller.values) return ASSETS_REFUSALS.values;
  return null;
}

@Injectable()
export class AssetsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const level = this.reflector.getAllAndOverride<AssetsAccess | undefined>(LEVEL, targets) ?? 'viewer';
    const values = this.reflector.getAllAndOverride<boolean | undefined>(VALUES, targets) ?? false;
    const settings = this.reflector.getAllAndOverride<boolean | undefined>(SETTINGS, targets) ?? false;
    const req = ctx.switchToHttp().getRequest<AssetsRequest>();
    if (!req.user) throw new ForbiddenException(ASSETS_REFUSALS.none); // every route here needs a session (AuthGuard)
    const caller = await assetsCallerOf(this.prisma, req.user);
    const refusal = assetsRefusal(caller, { level, values, settings });
    if (refusal) throw new ForbiddenException(refusal);
    req.assets = caller;
    return true;
  }
}

/** The route needs at least this Assets access in effect (viewer, custodian, manager). */
export const AssetsLevel = (level: Exclude<AssetsAccess, 'none'>) => applyDecorators(SetMetadata(LEVEL, level), UseGuards(AssetsGuard));

/** The route is the values': the CEO, Finance or a Super Admin, at any level (they are at least viewers). */
export const AssetValues = () => applyDecorators(SetMetadata(LEVEL, 'viewer'), SetMetadata(VALUES, true), UseGuards(AssetsGuard));

/** The asset settings: an Assets manager, or someone who sets the values (the threshold decides what is Expensed). */
export const AssetSettingsAccess = () => applyDecorators(SetMetadata(LEVEL, 'viewer'), SetMetadata(SETTINGS, true), UseGuards(AssetsGuard));

/** The caller as AssetsGuard found them. */
export const CurrentAssetsCaller = createParamDecorator((_data: unknown, ctx: ExecutionContext): AssetsCaller => ctx.switchToHttp().getRequest<AssetsRequest>().assets!);
