import {
  isSignInMethod,
  isSignInOutcome,
  SIGN_IN_ACTIONS,
  SIGN_IN_METHOD_LABELS,
  SIGN_IN_OUTCOME_LABELS,
  signInOutcomeOk,
  type SignInMethod,
  type SignInOutcome,
} from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { likePattern } from './audit-query.js';
import { fromOf, shownMoment, type AuditFrom, type AuditPerson, type AuditRow } from './audit-view.js';

// The Audit Log's Sign-ins (owner, 31 October 2026: "Every sign-in in its own tab: when, email, outcome (signed in,
// wrong password, unknown email, locked out, code, fingerprint), IP and browser or app, with its own filters"; as the
// Trendlix website's sign-in log): the sign-in entries the services write to audit_log (SIGN_IN_ACTIONS), each with its
// outcome and how, read from the entry itself (the action and its diff), so the entries from before read too: a
// refusal from before its reason was kept is "Refused". An entry from before the address was kept takes its
// session's (the address and browser the session was opened with), when it names one.

/** The outcome of a sign-in entry, in SQL (SIGN_IN_OUTCOMES). */
export const OUTCOME_SQL = Prisma.sql`(CASE
  WHEN a.action IN ('login', 'device_login', 'api_docs_open') THEN 'signed_in'
  WHEN a.action = 'login_failed' AND a.diff->>'via' = 'email_code' THEN 'code_refused'
  WHEN a.action = 'login_failed' AND a.diff->>'reason' IN ('wrong_password', 'unknown_email', 'inactive', 'not_allowed') THEN a.diff->>'reason'
  WHEN a.action = 'login_locked_out' THEN 'locked_out'
  WHEN a.action = 'device_login_failed' THEN 'fingerprint_refused'
  WHEN a.action = 'login_code_sent' THEN 'code_sent'
  WHEN a.action = 'logout' THEN 'signed_out'
  WHEN a.action = 'password_set' THEN 'password_set'
  ELSE 'failed'
END)`;

/** How it was done, in SQL (SIGN_IN_METHODS); null for signing out and the connector's. */
export const METHOD_SQL = Prisma.sql`(CASE
  WHEN a.action IN ('device_login', 'device_login_failed') THEN 'fingerprint'
  WHEN a.action = 'api_docs_open' OR a.diff->>'to' = 'api_docs' OR (a.action = 'login_locked_out' AND a.diff->>'method' = 'api_docs') THEN 'api_docs'
  WHEN a.action = 'login_code_sent' OR a.diff->>'method' = 'email_code' OR a.diff->>'via' = 'email_code' THEN 'email_code'
  WHEN a.action = 'password_set' THEN 'link'
  WHEN a.action = 'logout' OR a.diff->>'kind' = 'connector' THEN NULL
  ELSE 'password'
END)`;

/** The Sign-ins tab's filters. */
export interface SignInFilters {
  from?: string;
  to?: string;
  outcome?: SignInOutcome;
  q?: string;
}

/** The WHERE of the sign-ins asked for: always the sign-in entries only. */
export function signInsWhere(f: SignInFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`a.action = ANY(${[...SIGN_IN_ACTIONS]}::text[])`];
  if (f.from) parts.push(Prisma.sql`a.at >= (${f.from}::date::timestamp AT TIME ZONE 'Africa/Cairo')`);
  if (f.to) parts.push(Prisma.sql`a.at < ((${f.to}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`);
  if (f.outcome) parts.push(Prisma.sql`${OUTCOME_SQL} = ${f.outcome}`);
  if (f.q) {
    const like = likePattern(f.q);
    parts.push(
      Prisma.sql`(COALESCE(a.diff->>'email', u.email) ILIKE ${like} OR COALESCE(a.ip, s.ip) ILIKE ${like} OR COALESCE(a.user_agent, s.user_agent) ILIKE ${like} OR a.city ILIKE ${like})`,
    );
  }
  return Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}`;
}

/** What the sign-in entries join: the account (by the entry's user, else the one it is on) and the session it opened. */
export const SIGN_INS_FROM = Prisma.sql`FROM audit_log a
  LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.entity_id)
  LEFT JOIN sessions s ON a.ip IS NULL AND s.id::text = a.diff->>'sessionId'`;

/** A sign-in entry as the query reads it. */
export interface SignInRow extends Pick<AuditRow, 'ip' | 'ipSource' | 'country' | 'region' | 'city' | 'userAgent' | 'latitude' | 'longitude' | 'accuracyMetres' | 'locationMock'> {
  id: bigint | string;
  at: Date | string;
  action: string;
  email: string | null;
  accountId: string | null;
  outcome: string;
  method: string | null;
  kind: string | null;
}

/** A sign-in as GET /audit/sign-ins answers it. */
export interface SignInView {
  id: string;
  at: string;
  /** In Cairo: "31/10/2026, 5:42 PM". */
  when: string;
  /** As typed (a refusal), or the account's. */
  email: string | null;
  /** The account it is on, with its employee's name; null for an email that is no one's. */
  user: AuditPerson | null;
  outcome: SignInOutcome;
  outcomeLabel: string;
  /** Went through (green), or refused (red). */
  ok: boolean;
  method: SignInMethod | null;
  methodLabel: string | null;
  /** The session's kind: 'web', 'app', 'connector'; null when the entry doesn't say. */
  kind: string | null;
  action: string;
  from: AuditFrom;
}

/** A sign-in row for reading; `people`: the accounts, with their employees' names. */
export function signInView(r: SignInRow, people: ReadonlyMap<string, AuditPerson>): SignInView {
  const at = r.at instanceof Date ? r.at : new Date(r.at);
  const outcome: SignInOutcome = isSignInOutcome(r.outcome) ? r.outcome : 'failed';
  const method = isSignInMethod(r.method) ? r.method : null;
  return {
    id: String(r.id),
    at: at.toISOString(),
    when: shownMoment(at),
    email: r.email,
    user: r.accountId ? (people.get(r.accountId) ?? null) : null,
    outcome,
    outcomeLabel: SIGN_IN_OUTCOME_LABELS[outcome],
    ok: signInOutcomeOk(outcome),
    method,
    methodLabel: method ? SIGN_IN_METHOD_LABELS[method] : null,
    kind: r.kind,
    action: r.action,
    from: fromOf(r),
  };
}
