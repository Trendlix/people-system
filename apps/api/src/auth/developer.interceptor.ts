import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEVELOPER_NO_FILES, developerPeople, developerQuery, maskForDeveloper, type DeveloperPeople } from '@trendlix/shared';
import type { Request } from 'express';
import { from, map, switchMap, type Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEVELOPER_MAY_SEE, NOT_FOR_DEVELOPERS } from './decorators.js';
import type { SessionUser } from './session-user.js';

// What a developer receives (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real
// numbers"; hidden: "Money and personal IDs"; then "make all real employees data encrypted for developer role").
// Global, after the guard has said the request is a developer's (SessionUser.developer):
// - a route marked @NotForDevelopers (payslips, bank files, exports, generated documents, scans, CVs, receipts, the
//   employees' photos) is refused before it runs, so nothing is made for them, nor logged as seen;
// - a file from a route not marked @DeveloperMaySee (the logo, an asset's photo, a blank template) is refused too, as a
//   safety net for a route not marked yet;
// - a search finds by a code only (EMP-…, APP-…), never by a name, and a person's name, email, national ID or phone as
//   a filter finds nothing (packages/shared developerQuery), so a real name can't be confirmed by searching for it;
// - every other answer is masked by packages/shared maskForDeveloper: money 0, personal IDs "••••", every person a
//   pseudonym ("Employee EMP-0182"), personal data and free text about people hidden, every real name, email, phone and
//   national ID in any text replaced. The pseudonyms come from the people the API knows (employees, accounts,
//   applicants, general CVs, offers), read a minute at a time; if they can't be read, the answer is refused rather than
//   given unmasked. Where a module has its own rights (the salary, bank and identity rights, the asset values) a
//   developer lacks them too (employees/access.ts, assets-access.ts), so those answers hide them before this masks.
// Anyone else's requests pass untouched.

/** Whether an answer is a file rather than data. */
const isFile = (body: unknown): boolean => body instanceof StreamableFile || Buffer.isBuffer(body) || body instanceof Uint8Array;

/** How long the people read for the pseudonyms are kept: a new person shows as theirs within a minute. */
const PEOPLE_TTL_MS = 60_000;

@Injectable()
export class DeveloperInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeveloperInterceptor.name);
  private people: { at: number; value: Promise<DeveloperPeople> } | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user?.developer) return next.handle();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NOT_FOR_DEVELOPERS, targets)) throw new ForbiddenException(DEVELOPER_NO_FILES);
    const maySee = this.reflector.getAllAndOverride<boolean>(DEVELOPER_MAY_SEE, targets) === true;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    // a name search finds nothing: the query the handler reads (its @Query() is read after this)
    const safer = developerQuery(req.query as Record<string, unknown>);
    if (safer) Object.defineProperty(req, 'query', { value: safer, writable: true, configurable: true, enumerable: true });
    return next.handle().pipe(
      switchMap((body: unknown) => {
        if (isFile(body)) {
          if (!maySee) throw new ForbiddenException(DEVELOPER_NO_FILES);
          return [body];
        }
        if (maySee) return [body];
        return from(this.knownPeople()).pipe(map((people) => maskForDeveloper(body, path, people)));
      }),
    );
  }

  /** The people the API knows, for the pseudonyms: read again once a minute; refused (503) if they can't be read. */
  private knownPeople(): Promise<DeveloperPeople> {
    const now = Date.now();
    if (!this.people || now - this.people.at > PEOPLE_TTL_MS) {
      const value = this.readPeople().catch((err: unknown) => {
        this.people = null;
        this.logger.warn(`The people for a developer's pseudonyms could not be read: ${(err as Error).message}`);
        throw new ServiceUnavailableException('This page can’t be shown to a developer right now. Please try again in a minute.');
      });
      this.people = { at: now, value };
    }
    return this.people.value;
  }

  private async readPeople(): Promise<DeveloperPeople> {
    const [employees, users, applications, generalCvs, offers] = await Promise.all([
      this.prisma.employee.findMany({
        select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, displayName: true, workEmail: true, personalEmail: true, emergencyName: true },
      }),
      this.prisma.user.findMany({ select: { id: true, email: true } }),
      this.prisma.jobApplication.findMany({ select: { id: true, number: true, fullName: true, email: true } }),
      this.prisma.generalCv.findMany({ select: { id: true, number: true, fullName: true, email: true } }),
      this.prisma.jobOffer.findMany({ select: { id: true, number: true, fullNameEn: true, fullNameAr: true, email: true } }),
    ]);
    return developerPeople({ employees, users, applicants: [...applications, ...generalCvs], offers });
  }
}
