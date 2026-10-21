import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { CONNECTOR_SCOPE, type Role } from '@trendlix/shared';
import { ONLY_SUPER_ADMIN_DELETES } from './roles.js';
import type { SessionUser } from './session-user.js';
import type { ActiveSession } from './sessions.service.js';
import type { SessionClaims } from './view-as.js';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';
export const FORBIDDEN_MESSAGE = 'forbiddenMessage';
export const VIEW_AS_CONTROL = 'viewAsControl';
export const CONNECTOR_SCOPE_KEY = 'connectorScope';

/** Endpoint can be called without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller needs at least one of these roles. A Super Admin counts as an Admin (see actsAs in roles.ts). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * The route is open to the Claude connector's tokens (owner, 21 October 2026: "the connection method": Claude reads the
 * Assets section and drafts assets, nothing else). A connector's token is refused on every route without it (see
 * auth.guard.ts); the route's own checks (the Assets access, the values rule) apply as for the website.
 */
export const ConnectorScope = () => SetMetadata(CONNECTOR_SCOPE_KEY, CONNECTOR_SCOPE);

/** What a connector's token is told on a route not open to it. */
export const CONNECTOR_NOT_OPEN = 'The Claude connector only reads Assets and drafts assets. This isn’t open to it.';

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

/** The request's session, kept on the server, as the guard found it: its id, kind and last activity (see sessions.service.ts). */
export const CurrentActiveSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveSession => ctx.switchToHttp().getRequest().activeSession,
);
