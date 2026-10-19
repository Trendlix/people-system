import { applyDecorators, CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionRequest } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfidentialService } from './confidential.service.js';

// The routes about one person's personal or pay data (owner, 19 October 2026: "make C level Employees details not
// visible to HR"): 404 when that person is C-level and the caller may not see them (ConfidentialService), the same 404
// as a record that isn't there, so its existence isn't confirmed. Checked after the sign-in and the roles (AuthGuard),
// before the route's service, which reads the record itself as before. The lists filter in their services.

/** The kinds of record a route names, each with the person it belongs to and the 404 its service answers. */
const SUBJECTS = {
  employee: 'Employee not found.',
  employment: 'Employment not found.',
  contract: 'Contract not found.',
  ending: 'Ending not found.',
  raiseRequest: 'Raise request not found.',
  document: 'Document not found.',
  paperwork: 'Document not found.',
  payrollLine: 'Payroll line not found.',
  adjustment: 'Addition or deduction not found.',
  advance: 'Advance or loan not found.',
  recurringDeduction: 'Recurring deduction not found.',
} as const;

export type ConfidentialSubject = keyof typeof SUBJECTS;

/** Where the record's id is: a route parameter (by its name), the query string or the JSON body (`{ query }`, `{ body }`). */
export type IdSource = string | { query: string } | { body: string };

interface Check {
  subject: ConfidentialSubject;
  from: IdSource;
}

export const CONFIDENTIAL_CHECKS = 'confidentialChecks';

/**
 * The route is about the person a record of `subject` belongs to, its id at `from` (the route parameter `id` unless
 * said): 404 when that person is hidden from the caller. Several may be given; a missing id (an optional query) passes.
 * A body in a form with a file (multipart) is read after the guards, so such a route's service checks the person itself.
 */
export function ConfidentialOf(subject: ConfidentialSubject, from: IdSource = 'id', ...more: Check[]) {
  return applyDecorators(SetMetadata(CONFIDENTIAL_CHECKS, [{ subject, from }, ...more] satisfies Check[]), UseGuards(ConfidentialGuard));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ConfidentialGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const checks = this.reflector.get<Check[] | undefined>(CONFIDENTIAL_CHECKS, ctx.getHandler()) ?? [];
    if (!checks.length) return true;
    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const user = req.user;
    if (!user) return true; // a public route: nothing of anyone's to hide here
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    if (!hidden.size) return true;
    for (const { subject, from } of checks) {
      for (const id of idsAt(req, from)) {
        // not an id: the route's own pipe refuses it (400)
        if (!UUID.test(id)) continue;
        const owner = await this.ownerOf(subject, id);
        if (owner && hidden.has(owner)) throw new NotFoundException(SUBJECTS[subject]);
      }
    }
    return true;
  }

  /** The person a record belongs to; null when there is no such record (its service answers 404 as before). */
  private async ownerOf(subject: ConfidentialSubject, id: string): Promise<string | null> {
    const p = this.prisma;
    const by = { where: { id } } as const;
    switch (subject) {
      case 'employee':
        return id;
      case 'employment':
        return (await p.employment.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'contract':
        return (await p.contract.findUnique({ ...by, select: { employment: { select: { employeeId: true } } } }))?.employment.employeeId ?? null;
      case 'ending':
        return (await p.employmentEnding.findUnique({ ...by, select: { employment: { select: { employeeId: true } } } }))?.employment.employeeId ?? null;
      case 'raiseRequest':
        return (await p.raiseRequest.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'document':
        return (await p.generatedDocument.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'paperwork':
        return (await p.paperworkItem.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'payrollLine':
        return (await p.payrollLine.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'adjustment':
        return (await p.payrollAdjustment.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'advance':
        return (await p.payrollAdvance.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
      case 'recurringDeduction':
        return (await p.recurringDeduction.findUnique({ ...by, select: { employeeId: true } }))?.employeeId ?? null;
    }
  }
}

/** The ids at `from` in the request: one, several (a body's array of ids) or none. */
function idsAt(req: SessionRequest, from: IdSource): string[] {
  const value: unknown =
    typeof from === 'string' ? req.params?.[from] : 'query' in from ? (req.query as Record<string, unknown> | undefined)?.[from.query] : (req.body as Record<string, unknown> | undefined)?.[from.body];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}
