import { WFH_LABEL } from '@trendlix/shared';
import type { LeaveTypeView } from '../../../../lib/types';
import { WFH_TYPE } from '../request-filters';

// Work from home on Record leave (owner, 26 October 2026, on its types, Annual, Casual, Sick, Unpaid with no Work from
// home: "YES move it to leaves"; asked what that means, "Show it with leave"): the types end with Work from home, which
// is not a leave type (never a LeaveType: it stays a work from home request, a working day with no balance). Choosing it
// shows the work from home record's fields in place of the leave's, the day and a reason, saved through HR's record of a
// work from home day (POST /wfh), approved at once with what it is recorded past, and lands on its page. One day at a
// time, as a work from home request is: the form has one day, not a range, so its notice and limits stay as they are.
// Someone in HR can't record their own (the API refuses it), so it says so. Pure code, tested; relative imports, as
// vitest doesn't know the @/ paths.

/** Record leave's Work from home choice, after the leave types: the same word as Leave Requests' Type filter. */
export const WFH_CHOICE = { value: WFH_TYPE, label: WFH_LABEL } as const;

/** Whether a choice of Record leave's types is Work from home rather than a leave type. */
export const isWfhChoice = (value: string) => value === WFH_CHOICE.value;

/** Record leave's types: "Choose a type", the leave types offered in their order, then Work from home. */
export function recordTypeChoices(types: readonly Pick<LeaveTypeView, 'id' | 'nameEn'>[]): { value: string; label: string }[] {
  return [{ value: '', label: 'Choose a type' }, ...types.map((t) => ({ value: t.id, label: t.nameEn })), { ...WFH_CHOICE }];
}

/** The hint under the types once Work from home is chosen: a working day, one at a time. */
export const WFH_CHOICE_HINT =
  'Not leave: a working day from home, with no balance; that day they check in from home. One day at a time: record each day on its own.';

/** The hint under Record leave's types. */
export const RECORD_TYPES_HINT = 'The types HR set up, each with its rules from the Labour Law; Work from home last, a working day rather than leave.';

/** Said in place of the work from home fields when the employee chosen is the user themself (the API refuses it). */
export const OWN_WFH_TEXT = 'Someone else in HR has to record your own work from home day, or ask for it from My Requests.';
