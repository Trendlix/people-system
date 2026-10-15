'use client';

import { NOTICE_UNIT_LABELS, NOTICE_UNITS } from '@trendlix/shared';
import Link from 'next/link';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { EndingRule, FormState } from '@/lib/types';

const choice =
  'flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/**
 * An ending rule's label, notice, pay in lieu and whether it is offered (HR and Admin). The API refuses resignation or
 * company notice under 3 months (Art. 156) and says why; the form keeps what was typed.
 */
export function EndingRuleForm({ action, rule }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; rule: EndingRule }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('label')} className="label">
          Name
        </label>
        <input
          id={fid('label')}
          name="label"
          required
          maxLength={200}
          defaultValue={valueOf(state, 'label', rule.label)}
          aria-describedby={fid('label-hint')}
          className="input"
        />
        <p id={fid('label-hint')} className="hint">
          As HR sees it when recording an ending.
        </p>
      </div>
      <fieldset aria-describedby={fid('notice-hint')}>
        <legend className="label">Notice</legend>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <div>
            <label htmlFor={fid('noticeAmount')} className="mb-1 block text-sm text-muted">
              How much
            </label>
            <input
              id={fid('noticeAmount')}
              name="noticeAmount"
              type="number"
              required
              min={0}
              step={1}
              defaultValue={valueOf(state, 'noticeAmount', String(rule.noticeAmount))}
              className="input"
            />
          </div>
          <div>
            <label htmlFor={fid('noticeUnit')} className="mb-1 block text-sm text-muted">
              Counted in
            </label>
            <select id={fid('noticeUnit')} name="noticeUnit" defaultValue={valueOf(state, 'noticeUnit', rule.noticeUnit)} className="input">
              {NOTICE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {NOTICE_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id={fid('notice-hint')} className="hint">
          0 for no notice. Working days follow the employee&apos;s shift (Sunday to Thursday when there is none).
        </p>
      </fieldset>
      <div className="space-y-2">
        <label className={choice}>
          <input type="checkbox" name="payInLieu" value="true" defaultChecked={rule.payInLieu} className="size-4 accent-accent" />
          The notice can be paid instead of worked
        </label>
        <label className={choice}>
          <input type="checkbox" name="active" value="true" defaultChecked={rule.active} aria-describedby={fid('active-hint')} className="size-4 accent-accent" />
          Offered
        </label>
        <p id={fid('active-hint')} className="hint">
          HR can choose an offered rule when recording an ending.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Save changes</SubmitButton>
        <Link href="/organization/contracts" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
