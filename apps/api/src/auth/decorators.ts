import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@trendlix/shared';
import { ONLY_SUPER_ADMIN_DELETES } from './roles.js';
import type { SessionUser } from './session-user.js';
import type { SessionClaims } from './view-as.js';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';
export const FORBIDDEN_MESSAGE = 'forbiddenMessage';
export const VIEW_AS_CONTROL = 'viewAsControl';

/** Endpoint can be called without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller needs at least one of these roles. A Super Admin counts as an Admin (see actsAs in roles.ts). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Every DELETE route: a Super Admin only, whatever roles could delete before (owner's decision, 15 October 2026).
 * The service method checks again (assertDeletes).
 */
export const DeletesRecords = () =>
  applyDecorators(SetMetadata(REQUIRED_ROLES, ['super_admin'] satisfies Role[]), SetMetadata(FORBIDDEN_MESSAGE, ONLY_SUPER_ADMIN_DELETES));

/**
 * The view-as switcher's own endpoints (switch, Act as them, back to my account): reached while viewing only, which
 * refuses every other change (see auth.guard.ts). Each checks for itself who may call it.
 */
export const ViewAsControl = () => SetMetadata(VIEW_AS_CONTROL, true);

/** The signed-in user: while a Super Admin views as someone, that user (see SessionUser). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user,
);

/** What the request's session token says, as the guard checked it (who is signed in, whom they view as, its expiry). */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionClaims => ctx.switchToHttp().getRequest().sessionClaims,
);
