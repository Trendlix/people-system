import { EARLIER_NOTES_AUTHOR, SCREENING_LIMITS } from '@trendlix/shared';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// HR's single notes box of before (an application's notes, a general CV's), moved into a first screening comment on its
// record (24 October 2026: the notes "moved into comments"; packages/shared screening.ts): written by "HR (earlier
// notes)", no author of its own and no verdict, at the record's last updated time. A one-off pass rather than the
// migration, so a record still waiting for its candidate (the candidates' backfill joins it) is moved once it has one:
// the candidates' sweep runs it after each backfill (on deploy, then every 10 minutes), and it is idempotent: a record's
// earlier notes are moved once (the partial unique indexes on from_notes; ON CONFLICT DO NOTHING), so a second run, or
// two at once, moves nothing more. The notes columns stay as they were, read only, for a while; nothing writes them now.

export const SCREENING_ENTITY = 'screening_comment';

/** What the notes' old addresses answer (410) since the notes became screening comments. */
export const NOTES_GONE = 'HR’s notes are screening comments now: add one on the Screening Comments card (POST /api/recruitment/comments).';

/** Every non-empty notes of an application or a general CV with a candidate, moved into its first comment once. */
export async function moveEarlierNotes(prisma: PrismaService, audit: AuditService): Promise<{ applications: number; generalCvs: number }> {
  const max = SCREENING_LIMITS.text;
  const applications = await prisma.$executeRaw`
    INSERT INTO "screening_comments" ("id", "candidate_id", "application_id", "author_label", "text", "from_notes", "created_at")
    SELECT gen_random_uuid(), a."candidate_id", a."id", ${EARLIER_NOTES_AUTHOR}, left(btrim(a."notes"), ${max}::int), true, a."updated_at"
    FROM "job_applications" a
    WHERE a."candidate_id" IS NOT NULL AND a."notes" IS NOT NULL AND btrim(a."notes") <> ''
    ON CONFLICT ("application_id") WHERE "from_notes" DO NOTHING`;
  const generalCvs = await prisma.$executeRaw`
    INSERT INTO "screening_comments" ("id", "candidate_id", "general_cv_id", "author_label", "text", "from_notes", "created_at")
    SELECT gen_random_uuid(), g."candidate_id", g."id", ${EARLIER_NOTES_AUTHOR}, left(btrim(g."notes"), ${max}::int), true, g."updated_at"
    FROM "general_cvs" g
    WHERE g."candidate_id" IS NOT NULL AND g."notes" IS NOT NULL AND btrim(g."notes") <> ''
    ON CONFLICT ("general_cv_id") WHERE "from_notes" DO NOTHING`;
  if (applications || generalCvs) await audit.record({ userId: null, action: 'move_notes', entityType: SCREENING_ENTITY, diff: { applications, generalCvs } });
  return { applications, generalCvs };
}
