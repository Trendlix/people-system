import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { auditVia, onBehalfById } from './audit-context.js';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: object;
}

// Writes the audit log required by the spec: every change, every login and every view of restricted data. While a Super
// Admin views as someone (owner's decision, 17 October 2026), each entry is the user's (userId, as the caller says) and
// records the Super Admin too (onBehalfById, from the request: see audit-context.ts); not on the Super Admin's own
// entries, e.g. switching back. Through the Claude connector (owner, 21 October 2026: "the connection method"), each entry
// is marked "via Claude connector" (via, from the request too: see audit-context.ts).
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const by = onBehalfById();
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        onBehalfById: by && by !== entry.userId ? by : null,
        via: auditVia(),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        // Round-trip through JSON so Dates and class instances are stored as plain values.
        diff: entry.diff === undefined ? undefined : (JSON.parse(JSON.stringify(entry.diff)) as Prisma.InputJsonValue),
      },
    });
  }
}

/** Fields whose value differs between `before` and `after`, as { field: { from, to } }. */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return out;
}
