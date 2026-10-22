import {
  candidateCode,
  candidateDecision,
  candidateEmail,
  candidateKeys,
  candidateMobile,
  cvFactsOf,
  keySetOf,
  matchKindOf,
  matchScore,
  matchSignals,
  type CandidateKey,
  type CandidateKeyKind,
  type MatchSignal,
} from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';

// Joining an application or a general CV to its candidate (owner, 22 October 2026: "how to make like a profile for each
// candidate to store history and prevent duplication? even if the same candidate applied for 2 jobs"; "Email or
// mobile"; packages/shared candidates.ts), in the transaction that makes it:
// - the candidates' lock first (one at a time, before the applications' number lock, so two at once never make two
//   profiles for one person, nor two applications of one person to one job; and never a deadlock: every path takes the
//   candidates' lock before any other);
// - the candidate holding the email, else the one holding the mobile, else a new one (CAN-0001 …); its new email and
//   mobile added, its latest name and links kept; an email of one and a mobile of another: the email's, and the pair a
//   possible duplicate for HR;
// - then, once the row is in, the candidate refreshed: what it is compared by (its keys) worked out again, its possible
//   matches (the duplicates, and the suggestions from the other signs: "HR decides from suggested match") recomputed
//   against every other candidate (a dismissed pair never comes back), and the employee it is linked to (hired from
//   an accepted offer, else the employee with one of its emails or its mobile: "Link and show rehire").

type Tx = Prisma.TransactionClient;

/** The candidates' advisory lock: held to the end of the transaction. */
export const CANDIDATE_LOCK = 'people-system:candidates';

export async function lockCandidates(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CANDIDATE_LOCK}))`;
}

/** A candidate found by an email or a mobile. */
export interface FoundCandidate {
  id: string;
  code: string;
}

/** Who holds the email and who the mobile (as compared: candidateEmail, candidateMobile). */
export interface FoundCandidates {
  email: string;
  mobile: string | null;
  byEmail: FoundCandidate | null;
  byMobile: FoundCandidate | null;
}

/** The candidate a merged one went into, followed to the end (a contact moves with a merge, so this is only a safety net). */
async function resolved(tx: Tx, id: string | null): Promise<FoundCandidate | null> {
  let current = id;
  for (let hops = 0; current && hops < 10; hops++) {
    const c = await tx.candidate.findUnique({ where: { id: current }, select: { id: true, code: true, mergedIntoId: true } });
    if (!c) return null;
    if (!c.mergedIntoId) return { id: c.id, code: c.code };
    current = c.mergedIntoId;
  }
  return null;
}

/** The candidates holding the email and the mobile: takes the candidates' lock first. */
export async function findCandidates(tx: Tx, contact: { email: string; mobile: string | null | undefined }): Promise<FoundCandidates> {
  await lockCandidates(tx);
  const email = candidateEmail(contact.email);
  const mobile = candidateMobile(contact.mobile);
  const [e, m] = await Promise.all([
    email ? tx.candidateContact.findUnique({ where: { kind_value: { kind: 'email', value: email } }, select: { candidateId: true } }) : null,
    mobile ? tx.candidateContact.findUnique({ where: { kind_value: { kind: 'mobile', value: mobile } }, select: { candidateId: true } }) : null,
  ]);
  return { email, mobile, byEmail: await resolved(tx, e?.candidateId ?? null), byMobile: await resolved(tx, m?.candidateId ?? null) };
}

/** The ids of the candidates found (the email's and the mobile's), each once. */
export const foundIds = (f: FoundCandidates): string[] => [...new Set([f.byEmail?.id, f.byMobile?.id].filter((x): x is string => !!x))];

/**
 * The candidates holding an email or a mobile, without the lock: for a check outside a transaction (the bulk upload's
 * rows as the page shows them). Empty for neither.
 */
export async function candidateIdsOf(db: Prisma.TransactionClient, contact: { email: string; mobile: string | null | undefined }): Promise<string[]> {
  const email = candidateEmail(contact.email);
  const mobile = candidateMobile(contact.mobile);
  if (!email && !mobile) return [];
  const rows = await db.candidateContact.findMany({
    where: { OR: [...(email ? [{ kind: 'email', value: email }] : []), ...(mobile ? [{ kind: 'mobile', value: mobile }] : [])] },
    select: { candidateId: true },
  });
  return [...new Set(rows.map((r) => r.candidateId))];
}

/** The next code of the series, CAN-0001 …, under the candidates' lock. */
export async function nextCandidateCode(tx: Tx): Promise<string> {
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(code from 5)::int) AS max FROM candidates WHERE code ~ '^CAN-[0-9]+$'`;
  return candidateCode((max ?? 0) + 1);
}

/** What joins a candidate: the person's details as the application or general CV has them. */
export interface CandidateInput {
  fullName: string;
  email: string;
  mobile: string | null | undefined;
  linkedin?: string | null;
  portfolio?: string | null;
  /** When it was sent (the backfill: the row's own time); now when left out. */
  at?: Date;
  /** The candidate it belongs to already (a general CV moved to a vacancy keeps its candidate). */
  candidateId?: string | null;
}

/** The candidate joined: a new one or one found; the other candidate holding the mobile, kept as a possible duplicate. */
export interface AttachedCandidate {
  id: string;
  code: string;
  created: boolean;
  possibleDuplicateOf: FoundCandidate | null;
}

/**
 * The candidate an application or a general CV joins (`found`: findCandidates, the lock held), its contacts and latest
 * name and links kept. The row is made by the caller with the id answered, then refreshCandidate.
 */
export async function attachCandidate(tx: Tx, input: CandidateInput, found: FoundCandidates): Promise<AttachedCandidate> {
  const at = input.at ?? new Date();
  const given = input.candidateId ? await resolved(tx, input.candidateId) : null;
  const decision = given
    ? { join: given.id, possibleDuplicateOf: [found.byEmail, found.byMobile].find((f) => f && f.id !== given.id)?.id ?? null }
    : candidateDecision({ byEmail: found.byEmail?.id ?? null, byMobile: found.byMobile?.id ?? null });
  const name = input.fullName.trim().replace(/\s+/g, ' ');
  let id: string;
  let code: string;
  let created = false;
  if (decision.join) {
    const c = await tx.candidate.findUniqueOrThrow({ where: { id: decision.join }, select: { id: true, code: true, lastAppliedAt: true } });
    id = c.id;
    code = c.code;
    // the latest name and links: only from what is as new as their newest (a general CV moved later keeps an older one's)
    if (!c.lastAppliedAt || at >= c.lastAppliedAt) {
      await tx.candidate.update({
        where: { id },
        data: { fullName: name, ...(input.linkedin && { linkedin: input.linkedin }), ...(input.portfolio && { portfolio: input.portfolio }), lastAppliedAt: at },
      });
    }
  } else {
    code = await nextCandidateCode(tx);
    const c = await tx.candidate.create({
      data: { code, fullName: name, linkedin: input.linkedin ?? null, portfolio: input.portfolio ?? null, lastAppliedAt: at, createdAt: at },
      select: { id: true },
    });
    id = c.id;
    created = true;
  }
  await keepContact(tx, id, 'email', found.email || null, found.byEmail?.id ?? null, at);
  await keepContact(tx, id, 'mobile', found.mobile, found.byMobile?.id ?? null, at);
  const dup = decision.possibleDuplicateOf ? ([found.byEmail, found.byMobile].find((f) => f?.id === decision.possibleDuplicateOf) ?? null) : null;
  return { id, code, created, possibleDuplicateOf: dup };
}

/** A contact kept on the candidate: added when nobody holds it, its last time seen moved on when it is theirs already. */
async function keepContact(tx: Tx, candidateId: string, kind: 'email' | 'mobile', value: string | null, holder: string | null, at: Date): Promise<void> {
  if (!value) return;
  if (!holder) {
    await tx.candidateContact.create({ data: { candidateId, kind, value, firstSeenAt: at, lastSeenAt: at } });
    return;
  }
  if (holder !== candidateId) return; // another candidate's: the possible duplicate
  await tx.candidateContact.updateMany({ where: { kind, value, lastSeenAt: { lt: at } }, data: { lastSeenAt: at } });
  await tx.candidateContact.updateMany({ where: { kind, value, firstSeenAt: { gt: at } }, data: { firstSeenAt: at } });
}

// ---------- refreshing a candidate ----------

/** What a candidate's applications, general CVs, readings and contacts say, for its keys. */
async function factsOf(tx: Tx, candidateId: string) {
  const [c, apps, cvs] = await Promise.all([
    tx.candidate.findUnique({ where: { id: candidateId }, select: { fullName: true, linkedin: true, portfolio: true, mergedIntoId: true, contacts: { select: { kind: true, value: true } } } }),
    tx.jobApplication.findMany({
      where: { candidateId },
      select: { email: true, mobile: true, linkedin: true, portfolio: true, fullName: true, employeeId: true, createdAt: true, cv: { select: { sha256: true } }, cvReading: { select: { facts: true } } },
    }),
    tx.generalCv.findMany({
      where: { candidateId },
      select: { email: true, mobile: true, linkedin: true, portfolio: true, fullName: true, createdAt: true, file: { select: { sha256: true } }, cvReading: { select: { facts: true } } },
    }),
  ]);
  return { c, apps, cvs };
}

/** The candidates' keys as kept, by candidate. */
async function keysOf(tx: Tx, ids: readonly string[]): Promise<Map<string, CandidateKey[]>> {
  const rows = ids.length ? await tx.candidateKey.findMany({ where: { candidateId: { in: [...ids] } }, select: { candidateId: true, kind: true, value: true } }) : [];
  const out = new Map<string, CandidateKey[]>();
  for (const r of rows) {
    const list = out.get(r.candidateId) ?? [];
    list.push({ kind: r.kind as CandidateKeyKind, value: r.value });
    out.set(r.candidateId, list);
  }
  return out;
}

/** The pair in its kept order: the smaller id first. */
export const pairOf = (x: string, y: string): { candidateAId: string; candidateBId: string } => (x < y ? { candidateAId: x, candidateBId: y } : { candidateAId: y, candidateBId: x });

/** At most this many other candidates compared at a refresh (a common name can be many people's). */
const OTHERS_CAP = 200;

/** What a refresh found: the candidate's open possible matches after it, and the employee it is linked to. */
export interface Refreshed {
  matches: { otherId: string; signals: MatchSignal[] }[];
  employeeId: string | null;
}

/**
 * A candidate worked out again, in the caller's transaction (the candidates' lock held): its keys, its possible matches
 * against every other candidate (a dismissed or merged pair left as it is), its employee and when it last applied. A
 * candidate merged into another has nothing left: its keys and open matches go.
 */
export async function refreshCandidate(tx: Tx, candidateId: string): Promise<Refreshed> {
  const { c, apps, cvs } = await factsOf(tx, candidateId);
  if (!c) return { matches: [], employeeId: null };
  const merged = c.mergedIntoId !== null;
  const readings = [...apps, ...cvs].map((r) => cvFactsOf(r.cvReading?.facts ?? null));
  const keys = merged
    ? []
    : candidateKeys({
        emails: [...c.contacts.filter((x) => x.kind === 'email').map((x) => x.value), ...apps.map((a) => a.email), ...cvs.map((g) => g.email)],
        mobiles: [...c.contacts.filter((x) => x.kind === 'mobile').map((x) => x.value), ...apps.map((a) => a.mobile), ...cvs.map((g) => g.mobile)],
        linkedins: [c.linkedin, ...apps.map((a) => a.linkedin), ...cvs.map((g) => g.linkedin)],
        portfolios: [c.portfolio, ...apps.map((a) => a.portfolio), ...cvs.map((g) => g.portfolio)],
        names: [c.fullName, ...apps.map((a) => a.fullName), ...cvs.map((g) => g.fullName)],
        cvHashes: [...apps.map((a) => a.cv?.sha256), ...cvs.map((g) => g.file?.sha256)],
        cvEmails: readings.flatMap((f) => f?.emails ?? []),
        cvPhones: readings.flatMap((f) => f?.phones ?? []),
      });
  await tx.candidateKey.deleteMany({ where: { candidateId } });
  if (keys.length) await tx.candidateKey.createMany({ data: keys.map((k) => ({ candidateId, kind: k.kind, value: k.value })), skipDuplicates: true });

  // the others sharing any of its values, then each compared on its own keys
  const values = [...new Set(keys.map((k) => k.value))];
  const sharing = values.length
    ? await tx.candidateKey.findMany({
        where: { value: { in: values }, candidateId: { not: candidateId }, candidate: { mergedIntoId: null } },
        select: { candidateId: true },
        distinct: ['candidateId'],
        take: OTHERS_CAP,
      })
    : [];
  const others = await keysOf(
    tx,
    sharing.map((s) => s.candidateId),
  );
  const mine = keySetOf(keys);
  const found = new Map<string, MatchSignal[]>();
  for (const [otherId, theirs] of others) {
    const signals = matchSignals(mine, keySetOf(theirs));
    if (signals.length) found.set(otherId, signals);
  }

  // the pairs kept: open ones updated or gone; dismissed and merged ones never touched (a dismissed pair never comes back)
  const existing = await tx.candidateMatch.findMany({
    where: { OR: [{ candidateAId: candidateId }, { candidateBId: candidateId }] },
    select: { id: true, candidateAId: true, candidateBId: true, status: true, kind: true, signals: true, score: true },
  });
  const byOther = new Map(existing.map((m) => [m.candidateAId === candidateId ? m.candidateBId : m.candidateAId, m]));
  for (const [otherId, m] of byOther) {
    if (m.status === 'open' && !found.has(otherId)) await tx.candidateMatch.delete({ where: { id: m.id } });
  }
  for (const [otherId, signals] of found) {
    const kind = matchKindOf(signals);
    const score = matchScore(signals);
    const m = byOther.get(otherId);
    if (!m) await tx.candidateMatch.create({ data: { ...pairOf(candidateId, otherId), kind, signals, score } });
    else if (m.status === 'open' && (m.kind !== kind || m.score !== score || m.signals.join() !== signals.join())) {
      await tx.candidateMatch.update({ where: { id: m.id }, data: { kind, signals, score } });
    }
  }

  // the employee: hired from an accepted offer, else the one with one of its emails, else its mobile
  const employeeId = merged ? null : await employeeOf(tx, apps, keys);
  const times = [...apps, ...cvs].map((r) => r.createdAt.getTime());
  await tx.candidate.update({
    where: { id: candidateId },
    data: { employeeId, ...(times.length && { lastAppliedAt: new Date(Math.max(...times)) }) },
  });
  const open = [...found.entries()].filter(([otherId]) => {
    const m = byOther.get(otherId);
    return !m || m.status === 'open';
  });
  return { matches: open.map(([otherId, signals]) => ({ otherId, signals })), employeeId };
}

/**
 * The employee a candidate is (the owner's "Link and show rehire"): the one hired from an accepted offer to one of its
 * applications; else one whose work or personal email is one of its emails; else one whose mobile is one of its
 * mobiles (both as compared: lower case, the system's phone rule). Null for none.
 */
async function employeeOf(tx: Tx, apps: readonly { employeeId: string | null; createdAt: Date }[], keys: readonly CandidateKey[]): Promise<string | null> {
  const hired = apps
    .filter((a) => a.employeeId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.employeeId;
  if (hired && (await tx.employee.count({ where: { id: hired } }))) return hired;
  const emails = keys.filter((k) => k.kind === 'email').map((k) => k.value);
  if (emails.length) {
    const byEmail = await tx.employee.findFirst({
      where: { OR: [{ workEmail: { in: emails, mode: 'insensitive' } }, { personalEmail: { in: emails, mode: 'insensitive' } }] },
      orderBy: { employeeCode: 'asc' },
      select: { id: true },
    });
    if (byEmail) return byEmail.id;
  }
  const mobiles = new Set(keys.filter((k) => k.kind === 'mobile').map((k) => k.value));
  if (mobiles.size) {
    const people = await tx.employee.findMany({ where: { mobile: { not: null } }, select: { id: true, mobile: true }, orderBy: { employeeCode: 'asc' } });
    const match = people.find((p) => {
      const m = candidateMobile(p.mobile);
      return m !== null && mobiles.has(m);
    });
    if (match) return match.id;
  }
  return null;
}
