'use client';

import { useState, type ComponentProps } from 'react';
import { useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { RecordWfhForm } from '../../attendance/wfh/wfh-forms';
import { NewLeaveForm } from '../leave-forms';
import { isWfhChoice, OWN_WFH_TEXT, RECORD_TYPES_HINT, recordTypeChoices, WFH_CHOICE, WFH_CHOICE_HINT } from './record-kind';

// Record leave's form (owner, 26 October 2026, on its types: "YES move it to leaves", then "Show it with leave"): the
// leave form, its types ending with Work from home; choosing that shows the work from home record's fields (the day and a
// reason, what refuses it and what it would be recorded past read as the day is chosen), the Type still first, saved as
// HR's record of a work from home day and opening its page. Choosing a leave type there brings the leave form back with
// it. Someone recording for themself is told someone else in HR has to (the API refuses it).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Work from home chosen: the Type, then the work from home record's fields (or why HR can't record their own). */
function WfhChosen({
  types,
  wfh,
  cancelHref,
  onType,
}: {
  types: ComponentProps<typeof NewLeaveForm>['types'];
  wfh: { action: Action; employee: { id: string; name: string }; own: boolean };
  cancelHref: string;
  onType: (typeId: string) => void;
}) {
  const fid = useFieldIds();
  const field = (
    <div>
      <label htmlFor={fid('type')} className="label">
        Type
      </label>
      {/* no name: the work from home record sends the day and the reason alone */}
      <Select id={fid('type')} value={WFH_CHOICE.value} onChange={(e) => onType(e.target.value)} aria-describedby={fid('type-hint')} className="input">
        {recordTypeChoices(types).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <p id={fid('type-hint')} className="hint">
        {WFH_CHOICE_HINT}
      </p>
    </div>
  );
  if (wfh.own) {
    return (
      <div className="card space-y-5 p-5">
        {field}
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {OWN_WFH_TEXT}
        </p>
      </div>
    );
  }
  return <RecordWfhForm action={wfh.action} employee={wfh.employee} cancelHref={cancelHref} typeField={field} />;
}

/** The leave form, or the work from home record once Work from home is chosen among its types. */
export function RecordLeaveForm({
  leave,
  wfh,
}: {
  leave: Omit<ComponentProps<typeof NewLeaveForm>, 'extraChoice' | 'startTypeId'>;
  /** HR's record of a work from home day: its action, the employee, and whether they are the user themself. */
  wfh: { action: Action; employee: { id: string; name: string }; own: boolean };
}) {
  const [wfhChosen, setWfhChosen] = useState(false);
  // the leave type chosen in the work from home form's Type, for the leave form it brings back
  const [typeId, setTypeId] = useState('');
  if (wfhChosen) {
    return (
      <WfhChosen
        types={leave.types}
        wfh={wfh}
        cancelHref={leave.cancelHref}
        onType={(next) => {
          if (isWfhChoice(next)) return;
          setTypeId(next);
          setWfhChosen(false);
        }}
      />
    );
  }
  return <NewLeaveForm {...leave} startTypeId={typeId} extraChoice={{ ...WFH_CHOICE, hint: RECORD_TYPES_HINT, onChoose: () => setWfhChosen(true) }} />;
}
