import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { seesFullNames, withColleagueNames } from '@trendlix/shared';
import type { Request } from 'express';
import { from, map, switchMap, type Observable } from 'rxjs';
import { ColleagueNamesService } from './colleague-names.service.js';
import type { SessionUser } from './session-user.js';

// Colleagues by their display names (owner, 31 October 2026: "for employees, make them see their coleagues display names,
// not full names - in any part or process in app and website"; packages/shared colleague-names.ts). Global, after the
// guard: an answer to anyone without HR, Finance, the CEO, Admin or the Super Admin among their roles (an employee, a
// manager; whoever a Super Admin views as) has every other person's full name swapped for their display name, in English
// and Arabic, wherever it is, so the website and the app show the same. Their own name stays. Files pass untouched (an
// employee's own documents), and a developer's answers are masked by the DeveloperInterceptor instead.

const isFile = (body: unknown): boolean => body instanceof StreamableFile || Buffer.isBuffer(body) || body instanceof Uint8Array;

@Injectable()
export class ColleagueNamesInterceptor implements NestInterceptor {
  constructor(private readonly names: ColleagueNamesService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const user = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>().user;
    if (!user || user.developer || seesFullNames(user.roles)) return next.handle();
    return next.handle().pipe(
      switchMap((body: unknown) => (body === undefined || body === null || isFile(body) ? [body] : from(this.names.swapFor(user.employeeId)).pipe(map((swap) => withColleagueNames(body, swap))))),
    );
  }
}
