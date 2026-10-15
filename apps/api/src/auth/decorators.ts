import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@trendlix/shared';
import { ONLY_SUPER_ADMIN_DELETES } from './roles.js';
import type { SessionUser } from './session-user.js';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';
export const FORBIDDEN_MESSAGE = 'forbiddenMessage';

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

/** The signed-in user. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user,
);
