'use client';

import { KPI_ATTENDANCE_IN_KPI_LABEL } from '@trendlix/shared';
import { startTransition, useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { ATTENDANCE_IN_KPI_RESCORE_NOTE, ATTENDANCE_IN_KPI_TEXT, attendanceInKpiConfirmText } from '../../kpis/templates/templates';

// Attendance in the KPI (owner, 25 October 2026, asked whether attendance is cut twice: "Fixed cut only"): HR's and the
// Super Admin's switch, as Payroll Setup's Pay overtime is one (a hidden "false" so switching it off is sent too). Save
// asks first, as it works the scorecards not yet final out again; the API checks and audits it.

export function AttendanceInKpiForm({ action, on }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; on: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [checked, setChecked] = useState(on);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (checked !== on && !window.confirm(attendanceInKpiConfirmText(checked))) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <input type="hidden" name="attendanceInKpi" value="false" />
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            name="attendanceInKpi"
            value="true"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            aria-describedby={fid('attendanceInKpi-hint')}
            className="size-5 accent-accent"
          />
          {KPI_ATTENDANCE_IN_KPI_LABEL}
        </label>
        <p id={fid('attendanceInKpi-hint')} className="hint max-w-3xl">
          {ATTENDANCE_IN_KPI_TEXT[checked ? 'on' : 'off']} {ATTENDANCE_IN_KPI_RESCORE_NOTE}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} disabled={checked === on}>
          Save
        </SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
