import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { AUDIT_VIA_CONNECTOR } from '@trendlix/shared';
import { Observable } from 'rxjs';
import type { SessionUser } from '../auth/session-user.js';
import type { AuditOrigin } from './audit-origin.js';

// Who else is behind a request, for its audit entries: the Super Admin viewing as the signed-in user (owner's decision,
// 17 October 2026). Every entry written while they view as someone records them too (audit_log.on_behalf_by), from
// here, so no call to AuditService.record names them itself. And how the request came: through the Claude connector
// (owner, 21 October 2026: "the connection method"), its entries marked "via Claude connector" (audit_log.via), from here
// too: the services write them as the user, as for the website. And where the request came from (owner, 31 October
// 2026: "with location and ip capture"): its address, place, browser or app and the phone's position (audit-origin.ts),
// read as it comes in (audit-requests.ts) and kept with every entry it writes; none for what no request writes.

export interface AuditContext {
  onBehalfById: string | null;
  via: string | null;
  /** A developer's request (22 October 2026): what they look at is logged as seen with the values hidden. */
  developer?: boolean;
  /** Where the request came from (31 October 2026). */
  origin?: AuditOrigin | null;
  /** The service wrote why it refused (a check-in refused …): the refusal isn't written again (audit-requests.ts). */
  refusalWritten?: boolean;
}

/** A request as the audit context reads it: whose (the guard's), its session, and where it came from (audit-requests.ts). */
export interface AuditedRequest {
  user?: SessionUser;
  activeSession?: { kind?: string };
  auditOrigin?: AuditOrigin;
  /** The context the request ran in, kept for the refused-attempt recorder. */
  auditContext?: AuditContext;
}

const store = new AsyncLocalStorage<AuditContext>();

/** The Super Admin behind the request being handled, or null: one's own session, or no request at all. */
export const onBehalfById = (): string | null => store.getStore()?.onBehalfById ?? null;

/** How the request being handled came, when not from the website or the app: 'claude_connector'; else null. */
export const auditVia = (): string | null => store.getStore()?.via ?? null;

/** Whether the request being handled is a developer's (owner, 22 October 2026: "not showing the real numbers"). */
export const auditByDeveloper = (): boolean => store.getStore()?.developer === true;

/** Where the request being handled came from, or null: no request at all (a scheduler, the nightly Zoho fetch). */
export const auditOrigin = (): AuditOrigin | null => store.getStore()?.origin ?? null;

/**
 * The audit context of a request once the guard has said whose it is: the Super Admin viewing as the user, the
 * connector, a developer, and where it came from; the phone's position only on an app session (a website session's
 * request never carries one, whatever it sends).
 */
export function auditContextOf(req: AuditedRequest): AuditContext {
  const kind = req.activeSession?.kind;
  const origin = req.auditOrigin ?? null;
  return {
    onBehalfById: req.user?.viewAs?.by.id ?? null,
    via: kind === 'connector' ? AUDIT_VIA_CONNECTOR : null,
    developer: req.user?.developer === true,
    origin: origin && origin.location && kind && kind !== 'app' ? { ...origin, location: null } : origin,
  };
}

/** Runs `work` with `context` as the request's (the refused-attempt recorder, after the answer has gone). */
export const runInAuditContext = <T>(context: AuditContext, work: () => T): T => store.run(context, work);

/** Marks the request being handled as having written its own refusal (AuditService, for an action ending "_refused"). */
export function noteRefusalWritten(): void {
  const context = store.getStore();
  if (context) context.refusalWritten = true;
}

/**
 * Global: runs each request with its audit context at hand: a Super Admin's while viewing as someone with their id,
 * one with a connector's token marked as the connector's, and every one with where it came from. After the guard,
 * which says whose request it is (see auth.guard.ts), and around everything after it: the pipes, the endpoint and the
 * services it calls. The handler is asked for inside the store, so its work stays in it (Nest binds it to where it is
 * asked for).
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuditedRequest>();
    const context = auditContextOf(req);
    req.auditContext = context;
    if (!context.onBehalfById && !context.via && !context.developer && !context.origin) return next.handle();
    return new Observable((subscriber) => store.run(context, () => next.handle().subscribe(subscriber)));
  }
}
