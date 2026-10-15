import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyCorrections, changedPhrases, LEARNED_FIELDS, type LearnedField } from './corrections.js';

const ENTITY = 'ocr_correction';

// Remembers HR's corrections to ID card readings and applies them to the next readings (see corrections.ts).
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The suggestions read from a card, with the learned fixes applied, and which fields they changed. */
  async apply<T extends Partial<Record<LearnedField, string>>>(suggestions: T): Promise<{ suggestions: T; corrected: LearnedField[] }> {
    const fields = LEARNED_FIELDS.filter((f) => suggestions[f]);
    if (!fields.length) return { suggestions, corrected: [] };
    const fixes = await this.prisma.ocrCorrection.findMany({ where: { field: { in: fields } }, select: { field: true, wrong: true, right: true } });
    const out = { ...suggestions };
    const corrected: LearnedField[] = [];
    for (const field of fields) {
      const fixed = applyCorrections(out[field] as string, fixes.filter((f) => f.field === field));
      if (fixed !== null) {
        (out as Record<LearnedField, string>)[field] = fixed;
        corrected.push(field);
      }
    }
    return { suggestions: out, corrected };
  }

  /**
   * Learns from what HR saved compared with what the card reading said: each changed phrase becomes a fix, or
   * confirms one already known. The same misreading corrected differently replaces the earlier fix.
   */
  async learn(items: { field: LearnedField; read: string; saved: string }[], user: SessionUser): Promise<{ learned: number }> {
    let learned = 0;
    for (const { field, read, saved } of items) {
      for (const [wrong, right] of changedPhrases(read, saved)) {
        const known = await this.prisma.ocrCorrection.findUnique({ where: { field_wrong: { field, wrong } } });
        if (!known) {
          await this.prisma.ocrCorrection.create({ data: { field, wrong, right, createdById: user.id } });
        } else {
          await this.prisma.ocrCorrection.update({
            where: { id: known.id },
            data: known.right === right ? { timesSeen: { increment: 1 } } : { right, timesSeen: 1 },
          });
        }
        learned++;
      }
    }
    // the words themselves are personal data: the log only says how many fixes were learned
    if (learned) await this.audit.record({ userId: user.id, action: 'learn', entityType: ENTITY, diff: { fixes: learned } });
    return { learned };
  }

  list() {
    return this.prisma.ocrCorrection.findMany({
      orderBy: [{ field: 'asc' }, { timesSeen: 'desc' }, { wrong: 'asc' }],
      select: { id: true, field: true, wrong: true, right: true, timesSeen: true, createdAt: true, updatedAt: true },
    });
  }

  /** Forgets a learned correction: a Super Admin only, like every deletion (owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const fix = await this.prisma.ocrCorrection.findUnique({ where: { id }, select: { field: true } });
    if (!fix) throw new NotFoundException('Correction not found.');
    await this.prisma.ocrCorrection.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { field: fix.field } });
  }
}
