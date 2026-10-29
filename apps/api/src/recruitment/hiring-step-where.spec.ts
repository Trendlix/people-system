import { HIRING_STEPS, hiringStepOf, type ApplicationStage } from '@trendlix/shared';
import { hiringStepInput, hiringStepWhere } from './recruitment-views.js';

// The applicants' ?step= filter (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted
// and accept or reject them - HR Screening and scheduling"; packages/shared hiring-steps.ts): each step's Prisma filter
// keeps exactly the applications hiringStepOf puts at that step, read here as the database would (a null never equals,
// nor is "not in", anything).

interface Row {
  stage: string;
  filteredOut: boolean;
  suggestion: string | null;
  screeningCall: string | null;
  vacancy: { hiringManagerId: string | null };
}

/** A filter of the shapes hiringStepWhere uses (AND, OR, equals, not, notIn, the vacancy's fields) on a row. */
function matches(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, unknown>[]).every((w) => matches(w, row));
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(w, row));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('not' in c) return c.not === null ? value !== null : value !== null && value !== c.not;
      if ('notIn' in c) return value !== null && !(c.notIn as unknown[]).includes(value);
      return matches(c, value as Record<string, unknown>);
    }
    return value === cond;
  });
}

const STAGES: ApplicationStage[] = ['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];

function* rows(): Generator<Row> {
  for (const stage of STAGES)
    for (const filteredOut of [false, true])
      for (const suggestion of [null, 'next', 'reject'])
        for (const screeningCall of [null, 'passed', 'failed'])
          for (const hiringManagerId of [null, '00000000-0000-0000-0000-000000000001']) yield { stage, filteredOut, suggestion, screeningCall, vacancy: { hiringManagerId } };
}

describe('the hiring step filter', () => {
  it('keeps exactly the applications at each step', () => {
    let kept = 0;
    for (const row of rows()) {
      const step = hiringStepOf(hiringStepInput(row));
      for (const s of HIRING_STEPS) {
        const ok = matches(hiringStepWhere(s) as Record<string, unknown>, row as unknown as Record<string, unknown>);
        expect(ok, `${s} on ${JSON.stringify(row)}`).toBe(step === s);
        if (ok) kept++;
      }
    }
    // shortlisted, not filtered out: 3 suggestions × 3 calls × with or without a hiring manager, each at one step
    expect(kept).toBe(18);
  });

  it('reads the rules’ input from a row', () => {
    expect(hiringStepInput({ stage: 'shortlisted', filteredOut: false, suggestion: 'next', screeningCall: 'passed', vacancy: { hiringManagerId: 'x' } })).toEqual({
      stage: 'shortlisted',
      filteredOut: false,
      hasHiringManager: true,
      suggestion: 'next',
      screeningCall: 'passed',
    });
    expect(hiringStepInput({ stage: 'applied', filteredOut: true, suggestion: 'maybe', screeningCall: 'perhaps', vacancy: { hiringManagerId: null } })).toEqual({
      stage: 'applied',
      filteredOut: true,
      hasHiringManager: false,
      suggestion: null,
      screeningCall: null,
    });
  });
});
