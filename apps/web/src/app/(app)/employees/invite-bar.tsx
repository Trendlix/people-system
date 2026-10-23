'use client';

import { useActionState } from 'react';
import { FormErrors } from '@/components/form';
import { SetUpEmailLink } from '@/components/set-up-email-link';
import { inviteQuestion } from '@/lib/access';
import { isEmailNotSetUp } from '@/lib/email-setup';
import { sendInvitations, type InviteState } from './access-actions';

// Send invitations on the Employees list (owner, 22 October 2026: "Create now, HR sends when ready"): to the people
// ticked in the Access column (their boxes belong to this form by its id), or to everyone not invited yet; a
// confirmation says how many first. Emailed in English and Arabic; the API checks who may and skips who can't be.

export const INVITE_FORM_ID = 'send-invitations';

/**
 * `setUpEmail`: a Super Admin, offered "Set up email" when the API says email isn't set up (owner, 23 October 2026: "why
 * dont we add SMTP setup in the organization setup").
 */
export function InviteBar({ notInvited, setUpEmail = false }: { notInvited: number; setUpEmail?: boolean }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(sendInvitations, {});
  return (
    <form
      id={INVITE_FORM_ID}
      action={formAction}
      onSubmit={(e) => {
        const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const all = button?.value === '1';
        const count = all ? notInvited : new FormData(e.currentTarget).getAll('employeeIds').length;
        if (!count) {
          e.preventDefault();
          window.alert('Tick the people to invite in the Access column first.');
          return;
        }
        if (!window.confirm(inviteQuestion(count))) e.preventDefault();
      }}
      className="space-y-3 border-t border-line px-4 py-3"
    >
      <FormErrors errors={state.errors} />
      {setUpEmail && isEmailNotSetUp(state.errors) && (
        <p className="text-sm">
          <SetUpEmailLink />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">
          {notInvited === 1 ? '1 person has an account and no invitation yet.' : `${notInvited} people have an account and no invitation yet.`}
        </span>
        <button type="submit" name="all" value="0" disabled={pending} className="btn btn-secondary">
          Invite ticked
        </button>
        <button type="submit" name="all" value="1" disabled={pending || notInvited === 0} className="btn btn-primary">
          {pending ? 'Sending…' : 'Send invitations to all'}
        </button>
      </div>
      {state.message && (
        <div role="status" className="text-sm">
          <p className="text-ok">{state.message}</p>
          {!!state.result?.skipped.length && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {state.result.skipped.map((s) => (
                <li key={s.employeeId}>
                  {s.fullNameEn}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
