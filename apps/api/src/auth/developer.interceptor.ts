import { ForbiddenException, Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEVELOPER_NO_FILES, maskForDeveloper } from '@trendlix/shared';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { DEVELOPER_MAY_SEE, NOT_FOR_DEVELOPERS } from './decorators.js';
import type { SessionUser } from './session-user.js';

// What a developer receives (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real
// numbers"; hidden: "Money and personal IDs"). Global, after the guard has said the request is a developer's
// (SessionUser.developer):
// - a route marked @NotForDevelopers (payslips, bank files, exports, generated documents, scans, CVs, receipts) is
//   refused before it runs, so nothing is made for them, nor logged as seen;
// - a file from a route not marked @DeveloperMaySee (the logo, a photo, a blank template) is refused too, as a safety
//   net for a route not marked yet;
// - every other answer is masked by packages/shared maskForDeveloper: every money field 0 (its text's digits hidden),
//   every personal ID "••••", by the explicit field lists there, the API path telling the few names that are money on
//   some pages only. Where a module has its own rights (the salary, bank and identity rights, the asset values) a
//   developer lacks them too (employees/access.ts, assets-access.ts), so those answers hide them before this masks.
// Anyone else's requests pass untouched.

/** Whether an answer is a file rather than data. */
const isFile = (body: unknown): boolean => body instanceof StreamableFile || Buffer.isBuffer(body) || body instanceof Uint8Array;

@Injectable()
export class DeveloperInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user?.developer) return next.handle();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NOT_FOR_DEVELOPERS, targets)) throw new ForbiddenException(DEVELOPER_NO_FILES);
    const maySee = this.reflector.getAllAndOverride<boolean>(DEVELOPER_MAY_SEE, targets) === true;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    return next.handle().pipe(
      map((body: unknown) => {
        if (isFile(body)) {
          if (!maySee) throw new ForbiddenException(DEVELOPER_NO_FILES);
          return body;
        }
        return maySee ? body : maskForDeveloper(body, path);
      }),
    );
  }
}
