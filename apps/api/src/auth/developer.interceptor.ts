import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DEVELOPER_NO_FILES, developerPeople, developerQuery, maskForDeveloper, type DeveloperDigest, type DeveloperPeople } from '@trendlix/shared';
import type { Request } from 'express';
import { from, map, switchMap, type Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEVELOPER_MAY_SEE, NOT_FOR_DEVELOPERS } from './decorators.js';
import { developerDigestOf, developerTagKeyOf } from './developer-tags.js';
import type { SessionUser } from './session-user.js';

// What a developer receives (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real
// numbers"; hidden: "Money and personal IDs"; then "make all real employees data encrypted for developer role").
// Global, after the guard has said the request is a developer's (SessionUser.developer):
// - a route marked @NotForDevelopers (payslips, bank files, exports, generated documents, scans, CVs, receipts, the
//   employees' photos) is refused before it runs, so nothing is made for them, nor logged as seen;
// - a file from a route not marked @DeveloperMaySee (the logo, an asset's photo, a blank template) is refused too, as a
//   safety net for a route not marked yet;
// - a search for people finds nothing, by a name or a code (23 October 2026: a code search would link a real code to its
//   tag); only assets, kits, custody records and vacancies are found, by their codes; a person's name, email, national
//   ID, phone or code as a filter finds nothing (packages/shared developerQuery);
// - every other answer is masked by packages/shared maskForDeveloper: money 0, personal IDs "••••", every person a
//   pseudonym, personal data and free text about people hidden, every real name, email, phone and national ID in any
//   text replaced; and, since the owner's "Hide per-person details" and "and the social insurance" (22 October 2026),
//   every person's job, terms, employment dates and social insurance hidden, the company's setup pages readable with
//   their people cut off (hideJobForDeveloper); and, since "in developer view use **** instead of IDs" (23 October
//   2026), every person's code "••••" (an employee's, an application's, a candidate's, an offer's, a contract's), the
//   pseudonym a tag read with the server's key (developer-tags.ts) from the record's id ("Employee 7K3Q"), the same
//   person's the same tag as an employee, an account, a candidate, an applicant and an offer, and every contract,
//   employment, ending and raise answer without its dates. The pseudonyms come from the people the API knows
//   (employees, accounts, applicants, general CVs, offers, candidates), read a minute at a time; if they can't be read,
//   the answer is refused rather than given unmasked. Where a module has its own rights (the salary, bank and identity
//   rights, the asset values) a developer lacks them too (employees/access.ts, assets-access.ts), so those answers hide
//   them before this masks.
// Anyone else's requests pass untouched.

/** Whether an answer is a file rather than data. */
const isFile = (body: unknown): boolean => body instanceof StreamableFile || Buffer.isBuffer(body) || body instanceof Uint8Array;

/** How long the people read for the pseudonyms are kept: a new person shows as theirs within a minute. */
const PEOPLE_TTL_MS = 60_000;

@Injectable()
export class DeveloperInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeveloperInterceptor.name);
  private people: { at: number; value: Promise<DeveloperPeople> } | null = null;
  /** The keyed digest the people's tags are read with (the server's JWT_SECRET, developer-tags.ts). */
  private readonly digest: DeveloperDigest;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.digest = developerDigestOf(developerTagKeyOf(config.getOrThrow<string>('JWT_SECRET')));
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user?.developer) return next.handle();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NOT_FOR_DEVELOPERS, targets)) throw new ForbiddenException(DEVELOPER_NO_FILES);
    const maySee = this.reflector.getAllAndOverride<boolean>(DEVELOPER_MAY_SEE, targets) === true;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    // a name search finds nothing, and a list of people isn't narrowed by department, job title, grade or employment type
    // (22 October 2026: "Hide per-person details"): the query the handler reads (its @Query() is read after this)
    const safer = developerQuery(req.query as Record<string, unknown>, path);
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
    // with when each was added (the first keeps a tag two share) and what links one person's records (23 October 2026:
    // one person, one tag): an account's employee, a candidate's, an application's and a general CV's candidate, an
    // offer's employee and application
    const [employees, users, applications, generalCvs, offers, candidates] = await Promise.all([
      this.prisma.employee.findMany({
        select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, displayName: true, workEmail: true, personalEmail: true, emergencyName: true, createdAt: true },
      }),
      this.prisma.user.findMany({ select: { id: true, email: true, employeeId: true, createdAt: true } }),
      this.prisma.jobApplication.findMany({ select: { id: true, number: true, fullName: true, email: true, candidateId: true, createdAt: true } }),
      this.prisma.generalCv.findMany({ select: { id: true, number: true, fullName: true, email: true, candidateId: true, createdAt: true } }),
      this.prisma.jobOffer.findMany({ select: { id: true, number: true, fullNameEn: true, fullNameAr: true, email: true, employeeId: true, applicationId: true, createdAt: true } }),
      this.prisma.candidate.findMany({ select: { id: true, code: true, fullName: true, employeeId: true, createdAt: true } }),
    ]);
    return developerPeople({ employees, users, applicants: [...applications, ...generalCvs], offers, candidates }, this.digest);
  }
}
