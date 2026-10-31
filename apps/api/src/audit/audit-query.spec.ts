import { Prisma } from '../generated/prisma/client.js';
import { aboutPeople, auditWhere, likePattern } from './audit-query.js';

// Which entries the Audit Log lists (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): every
// filter a bound value, the days Cairo's, one person's everything, and never those about people hidden from the caller.

const MONA = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const RECORD = 'bbbbbbbb-0000-4000-8000-000000000001';

/** The SQL with one space between words, for reading in a test. */
const text = (sql: Prisma.Sql) => sql.sql.replace(/\s+/g, ' ').trim();

describe('the Audit Log’s filters', () => {
  it('asks for nothing when nothing is asked', () => {
    expect(auditWhere({})).toBe(Prisma.empty);
  });

  it('binds every value, the days as Cairo’s', () => {
    const where = auditWhere({ from: '2026-10-01', to: '2026-10-31', userId: USER, action: 'update', entityType: 'contract', entityId: RECORD, q: 'CON-2026', before: '120' });
    expect(text(where)).toBe(
      [
        "WHERE a.at >= (?::date::timestamp AT TIME ZONE 'Africa/Cairo')",
        "AND a.at < ((?::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')",
        'AND (a.user_id = ?::uuid OR a.on_behalf_by = ?::uuid)',
        'AND a.action = ?',
        'AND a.entity_type = ?',
        'AND a.entity_id = ?::uuid',
        // the search finds the address or the city an entry came from too (31 October 2026)
        'AND (a.diff::text ILIKE ? OR a.ip ILIKE ? OR a.city ILIKE ?)',
        'AND a.id < ?::bigint',
      ].join(' '),
    );
    expect(where.values).toEqual(['2026-10-01', '2026-10-31', USER, USER, 'update', 'contract', RECORD, '%CON-2026%', '%CON-2026%', '%CON-2026%', '120']);
  });

  // owner, 31 October 2026: "filter by module, as the website does"; "a Result column, Succeeded or Refused"
  it('filters by module (its kinds of record and its refused attempts) and by result', () => {
    const where = auditWhere({ module: 'assets', result: 'refused' });
    expect(text(where)).toBe('WHERE a.entity_type = ANY(?::text[]) AND a.action = ANY(?::text[])');
    expect(where.values[0]).toEqual(expect.arrayContaining(['asset', 'custody_record', 'assets']));
    expect(where.values[1]).toEqual(expect.arrayContaining(['refused', 'login_failed', 'check_in_refused']));
    expect(text(auditWhere({ result: 'succeeded' }))).toBe('WHERE NOT (a.action = ANY(?::text[]))');
  });

  it('takes the search text literally', () => {
    expect(likePattern('50%_off\\now')).toBe('%50\\%\\_off\\\\now%');
  });

  it('finds everything about one person: their profile, their records and what names them', () => {
    const sql = aboutPeople({ ids: [MONA], codes: ['EMP-0007'] });
    const words = text(sql);
    expect(words.startsWith('COALESCE((')).toBe(true);
    for (const part of [
      "(a.entity_type = 'employee' AND a.entity_id = ANY(?::uuid[]))",
      "a.diff->>'employeeId' = ANY(?::text[])",
      "a.diff->>'employmentId' IN (SELECT e.id::text FROM employments e WHERE e.employee_id = ANY(?::uuid[]))",
      "(a.entity_type IN ('employment', 'final_settlement') AND a.entity_id IN (SELECT e.id FROM employments e WHERE e.employee_id = ANY(?::uuid[])))",
      '(a.entity_type = ? AND a.entity_id IN (SELECT t.id FROM "payroll_lines" t WHERE t.employee_id = ANY(?::uuid[])))',
      '(a.entity_type = ? AND a.entity_id IN (SELECT t.id FROM "leave_requests" t WHERE t.employee_id = ANY(?::uuid[])))',
      '(a.entity_type = ? AND a.entity_id IN (SELECT t.id FROM "reimbursement_claims" t WHERE t.employee_id = ANY(?::uuid[])))',
      'FROM contracts c WHERE c.employment_id IN',
      'FROM leave_documents d JOIN leave_requests r',
      'FROM reimbursement_receipts x JOIN reimbursement_claims r',
    ]) {
      expect(words).toContain(part);
    }
    expect(words.endsWith('), false)')).toBe(true);
    // never by employee code: a deleted person's code is given to the next one hired
    expect(words).not.toContain('employeeCode');
    expect(sql.values).not.toContainEqual(['EMP-0007']);
    expect(sql.values).toContain('payroll_line');
    expect(sql.values.filter((v) => Array.isArray(v) && v[0] === MONA).length).toBeGreaterThan(10);
  });

  it('adds one person’s everything to the other filters', () => {
    const where = auditWhere({ action: 'update' }, { ids: [MONA], codes: ['EMP-0007'] });
    expect(text(where)).toMatch(/^WHERE a\.action = \? AND COALESCE\(\(/);
  });

  it('leaves out the people hidden from the caller, and nobody when none is', () => {
    const where = auditWhere({}, null, { ids: [MONA], codes: ['EMP-0007'] });
    expect(text(where)).toMatch(/^WHERE NOT COALESCE\(\(/);
    expect(auditWhere({}, null, { ids: [], codes: [] })).toBe(Prisma.empty);
  });
});
