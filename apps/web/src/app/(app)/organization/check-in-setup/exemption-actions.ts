'use server';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"): exempting one person (their profile) or several at once (Check-in Setup's "Add people"), and
// "End now". Each forwards to the API, which checks the role (HR, Admin, the Super Admin; a C-level person's only the CEO
// or a Super Admin), the dates (never overlapping another period of theirs, never in a month whose payroll is with the
// CEO, approved or paid) and the reason again, so calling these directly can't bypass them; it refills the drafts of the
// months it touches and keeps every change in the audit log.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { todayInCairo } from '@/lib/date-picker';
import type { CheckInExemptionView, EndedExemptionView } from '@/lib/exemption-types';
import type { FormState } from '@/lib/types';
import { addedExemptionsText, endedExemptionText, exemptionBody } from './exemptions';

const EXEMPTIONS = '/attendance/check-in-exemptions';

/** The submitted values, so the form can be refilled after an error (the people chosen as a list). */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of fd) {
    if (key.startsWith('$ACTION') || typeof value !== 'string') continue;
    if (key === 'employeeId') out[key] = [...((out[key] as string[] | undefined) ?? []), value];
    else out[key] = value;
  }
  return out;
}

/** Exempts the people chosen (POST /attendance/check-in-exemptions { employeeIds, reason, startDate, endDate }). */
export async function addExemptions(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = exemptionBody(fd, todayInCairo());
  if (!body) return { errors: problems, values: submitted(fd) };
  let made: { exemptions: CheckInExemptionView[] } | undefined;
  try {
    made = await apiSend<{ exemptions: CheckInExemptionView[] }>('POST', EXEMPTIONS, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  refresh();
  return { message: made?.exemptions.length ? addedExemptionsText(made.exemptions) : 'Saved.' };
}

/** Ends a period today, or removes it when it hasn't started (POST /attendance/check-in-exemptions/:id/end). */
export async function endExemption(id: string, name: string): Promise<FormState> {
  let ended: EndedExemptionView | undefined;
  try {
    ended = await apiSend<EndedExemptionView>('POST', `${EXEMPTIONS}/${encodeURIComponent(id)}/end`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: endedExemptionText(name, ended?.removed ?? false) };
}
