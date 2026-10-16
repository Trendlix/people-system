import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { SessionUser } from '../auth/session-user.js';

// Who else is behind a request, for its audit entries: the Super Admin viewing as the signed-in user (owner's decision,
// 17 October 2026). Every entry written while they view as someone records them too (audit_log.on_behalf_by), from
// here, so no call to AuditService.record names them itself.

const store = new AsyncLocalStorage<{ onBehalfById: string }>();

/** The Super Admin behind the request being handled, or null: one's own session, or no request at all. */
export const onBehalfById = (): string | null => store.getStore()?.onBehalfById ?? null;

/**
 * Global: runs each request a Super Admin makes while viewing as someone with their id at hand. After the guard, which
 * says whose request it is (see auth.guard.ts), and around everything after it: the pipes, the endpoint and the services
 * it calls. The handler is asked for inside the store, so its work stays in it (Nest binds it to where it is asked for).
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const by = ctx.switchToHttp().getRequest<{ user?: SessionUser }>().user?.viewAs?.by.id;
    if (!by) return next.handle();
    return new Observable((subscriber) => store.run({ onBehalfById: by }, () => next.handle().subscribe(subscriber)));
  }
}
