import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_LABELS, actionLabel, ENTITY_LABELS, entityLabel, fieldLabel, humanized } from './audit-labels.js';

// The Audit Log's words (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): every action and
// kind of record the services write to audit_log has a label, read from the sources themselves, so a new one shows up
// here until it has words.

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'generated') sources(path, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

const texts = sources(SRC).map((p) => readFileSync(p, 'utf8'));
const literals = (text: string) => [...text.matchAll(/'([a-z][a-z_]*)'/g)].map((m) => m[1]);

/** The actions written with `action: …`: a literal, either side of a ternary, or the values of a lookup object. */
function writtenActions(): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text.includes('audit')) continue;
    for (const m of text.matchAll(/\baction: ([^\n]+)/g)) {
      const expr = m[1];
      if (expr.startsWith("'")) out.add(literals(expr)[0]);
      else if (expr.includes('?')) for (const l of literals(expr.slice(expr.indexOf('?')))) out.add(l);
      else if (expr.startsWith('{')) for (const l of [...expr.matchAll(/: '([a-z_]+)'/g)].map((x) => x[1])) out.add(l);
    }
  }
  return out;
}

/** The kinds of record written with `entityType: …`: a literal, or a constant holding one (`const ENTITY = 'contract'`). */
function writtenEntityTypes(): Set<string> {
  const constants = new Map<string, Set<string>>();
  for (const text of texts) {
    for (const m of text.matchAll(/(?:^|\n)(?:export )?const ([A-Z_]+) = '([a-z][a-z_]*)';/g)) {
      if (!constants.has(m[1])) constants.set(m[1], new Set());
      constants.get(m[1])!.add(m[2]);
    }
  }
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(/\bentityType: '([a-z][a-z_]*)'/g)) out.add(m[1]);
    for (const m of text.matchAll(/\bentityType: ([A-Z_]+)\b/g)) for (const v of constants.get(m[1]) ?? []) out.add(v);
  }
  return out;
}

describe('the audit log in words', () => {
  it('has words for every action the services write', () => {
    const actions = writtenActions();
    // passed through a helper (payroll status changes, endings, raise steps, document steps)
    for (const a of ['submit', 'return', 'approve', 'paid', 'reject', 'withdraw', 'complete', 'print', 'verify']) actions.add(a);
    expect(actions.size).toBeGreaterThan(40);
    expect([...actions].filter((a) => !(a in ACTION_LABELS))).toEqual([]);
  });

  it('has words for every kind of record the services write', () => {
    const types = writtenEntityTypes();
    expect(types.size).toBeGreaterThan(35);
    for (const t of ['employee', 'contract', 'payroll_line', 'leave_request', 'reimbursement_claim', 'raise_request', 'user']) expect(types).toContain(t);
    expect([...types].filter((t) => !(t in ENTITY_LABELS))).toEqual([]);
  });

  it('labels the common ones in sentence case', () => {
    expect(actionLabel('update')).toBe('Updated');
    expect(actionLabel('view_restricted')).toBe('Viewed restricted data');
    expect(actionLabel('submit')).toBe('Sent for approval');
    expect(entityLabel('payroll_adjustment')).toBe('Addition or deduction');
    expect(entityLabel('profile_change_request')).toBe('Details change request');
    for (const label of [...Object.values(ACTION_LABELS), ...Object.values(ENTITY_LABELS)]) {
      expect(label[0]).toBe(label[0].toUpperCase());
      // sentence case: no word after the first capitalised, but names (Act as them, CEO, HR, Claude: the connector, 21
      // October 2026; Google Maps, 24 October 2026; WhatsApp, 24 October 2026)
      expect(label.slice(1).split(' ').filter((w) => /^[A-Z][a-z]/.test(w) && !['Act', 'Claude', 'Google', 'Maps', 'WhatsApp'].includes(w))).toEqual([]);
    }
  });

  it('reads a key it has no words for', () => {
    expect(humanized('waive_attendance_later')).toBe('Waive attendance later');
    expect(actionLabel('something_new')).toBe('Something new');
    expect(entityLabel('brand_new_thing')).toBe('Brand new thing');
  });

  it('names the fields of a change', () => {
    expect(fieldLabel('grossSalary')).toBe('Gross salary');
    expect(fieldLabel('fullNameEn')).toBe('Full name (English)');
    expect(fieldLabel('nameAr')).toBe('Name (Arabic)');
    expect(fieldLabel('contractId')).toBe('Contract ID');
    expect(fieldLabel('ceoNote')).toBe('CEO note');
    expect(fieldLabel('accountNo')).toBe('Account number');
    expect(fieldLabel('iban')).toBe('IBAN');
    expect(fieldLabel('managerId')).toBe('Direct manager');
    expect(fieldLabel('status')).toBe('Status');
    expect(fieldLabel('reimbursement_type')).toBe('Reimbursement type');
  });
});
