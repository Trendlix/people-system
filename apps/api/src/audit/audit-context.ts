import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { AUDIT_VIA_CONNECTOR } from '@trendlix/shared';
import { Observable } from 'rxjs';
import type { SessionUser } from '../auth/session-user.js';

// Who else is behind a request, for its audit entries: the Super Admin viewing as the signed-in user (owner's decision,
// 17 October 2026). Every entry written while they view as someone records them too (audit_log.on_behalf_by), from
// here, so no call to AuditService.record names them itself. And how the request came: through the Claude connector
// (owner, 21 October 2026: "the connection method"), its entries marked "via Claude connector" (audit_log.via), from here
// too: the services write them as the user, as for the website.

interface AuditContext {
  onBehalfById: string | null;
  via: string | null;
  /** A developer's request (22 October 2026): what they look at is logged as seen with the values hidden. */
  developer?: boolean;
}

const store = new AsyncLocalStorage<AuditContext>();

/** The Super Admin behind the request being handled, or null: one's own session, or no request at all. */
export const onBehalfById = (): string | null => store.getStore()?.onBehalfById ?? null;

/** How the request being handled came, when not from the website or the app: 'claude_connector'; else null. */
export const auditVia = (): string | null => store.getStore()?.via ?? null;

/** Whether the request being handled is a developer's (owner, 22 October 2026: "not showing the real numbers"). */
export const auditByDeveloper = (): boolean => store.getStore()?.developer === true;

/**
 * Global: runs each request a Super Admin makes while viewing as someone with their id at hand, and each request with a
 * connector's token marked as the connector's. After the guard, which says whose request it is (see auth.guard.ts), and
 * around everything after it: the pipes, the endpoint and the services it calls. The handler is asked for inside the
 * store, so its work stays in it (Nest binds it to where it is asked for).
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ user?: SessionUser; activeSession?: { kind?: string } }>();
    const by = req.user?.viewAs?.by.id ?? null;
    const via = req.activeSession?.kind === 'connector' ? AUDIT_VIA_CONNECTOR : null;
    const developer = req.user?.developer === true;
    if (!by && !via && !developer) return next.handle();
    return new Observable((subscriber) => store.run({ onBehalfById: by, via, developer }, () => next.handle().subscribe(subscriber)));
  }
}
