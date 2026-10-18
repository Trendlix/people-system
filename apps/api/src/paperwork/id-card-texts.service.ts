import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ID_CARD_SIDES, keptText } from './paperwork.service.js';

/** How many texts are read at a time. */
const BATCH = 200;

/**
 * How long the clean-up may hold up the API's start: what is left is cleaned the next time it starts. The API's health
 * check allows a minute from the start, then five tries 15 seconds apart (apps/api/Dockerfile), and the tables are
 * brought up to date in that time too.
 */
const BUDGET_MS = 15_000;

const ENTITY = 'paperwork';

/** Why the texts changed, in the audit log. */
export const RELIGION_CLEANED = 'The religion taken out of the text of national ID cards read before 16 October 2026';

// The religion printed on the back of the national ID card has been left out of the text kept since 16 October 2026
// (keptText, commit 33328ae); text read before then still held it in the database and was only shown without it. The
// owner had it taken out of those too (18 October 2026: "I am not interested in the religion field in both systems";
// asked whether to remove it from the records stored before 16 October: yes). So when the API starts, the text of every
// side of the national ID card is made what keptText keeps for a new read: the same function, so the same rule (a back's
// religion; a front's only on a page that shows the back, so that a name such as مسلم on a front alone stays). Nothing
// else of a paper changes: not its file, its status or when it was read, and other papers are not looked at. Done here
// rather than in a migration as the rule is TypeScript (egyptian-id.ts withoutReligion: Arabic normalisation and a word
// list). Once done there is nothing left to clean, so it changes nothing the next time. One audit entry says how many
// texts were cleaned, never what they said; the log says how many and nothing else.
@Injectable()
export class IdCardTextsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdCardTextsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { cleaned, more } = await this.clean();
      if (cleaned) this.logger.log(`Took the religion out of the text of ${cleaned} national ID card sides read before 16 October 2026.`);
      if (more) this.logger.log('Some national ID card texts are left to clean: they are cleaned the next time the API starts.');
    } catch (err) {
      // never stops the API from starting; only the kind of error is logged, as its message may quote a text
      this.logger.error(`The national ID card texts read before 16 October 2026 could not be cleaned this time (${errorKind(err)}); they are shown without the religion, and cleaned the next time the API starts.`);
    }
  }

  /**
   * Keeps the stored text of each side of the national ID card as keptText keeps it, a batch at a time, until none is
   * left or the time given has passed (then `more`: the rest is cleaned the next time). All or nothing: the texts it
   * changed and the one audit entry with their number go together. A text changed meanwhile is left to its new reading.
   * Answers how many texts it changed.
   */
  async clean({ batch = BATCH, budgetMs = BUDGET_MS } = {}): Promise<{ cleaned: number; more: boolean }> {
    const deadline = Date.now() + budgetMs;
    return this.prisma.$transaction(
      async (tx) => {
        let cleaned = 0;
        let more = false;
        let after: string | undefined;
        for (;;) {
          // the text only: never the file
          const rows = await tx.paperworkItem.findMany({
            where: { kind: { in: [...ID_CARD_SIDES] }, ocrText: { not: null }, ...(after !== undefined && { id: { gt: after } }) },
            select: { id: true, kind: true, ocrText: true },
            orderBy: { id: 'asc' },
            take: batch,
          });
          for (const { id, kind, ocrText } of rows) {
            if (ocrText === null) continue;
            const kept = keptText(ocrText, kind);
            if (kept === ocrText) continue;
            // only while it is still the text read here
            cleaned += (await tx.paperworkItem.updateMany({ where: { id, ocrText }, data: { ocrText: kept } })).count;
          }
          if (rows.length < batch) break;
          after = rows[rows.length - 1].id;
          if (Date.now() >= deadline) {
            more = true;
            break;
          }
        }
        if (cleaned) {
          // as AuditService.record writes it (by nobody: the system), in this transaction so that it goes with the texts
          await tx.auditLog.create({
            data: { userId: null, action: 'update', entityType: ENTITY, entityId: null, diff: { ocrText: 'religion removed', items: cleaned, reason: RELIGION_CLEANED } },
          });
        }
        return { cleaned, more };
      },
      // the time given, and the last batch begun within it
      { timeout: budgetMs + 60_000 },
    );
  }
}

/** The kind of an error, never its message. */
function errorKind(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,12}$/.test(code)) return code;
  return err instanceof Error ? err.name : 'unknown';
}
