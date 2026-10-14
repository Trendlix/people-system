import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: object;
}

// Writes the audit log required by the spec: every change, every login and every view of restricted data.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
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
