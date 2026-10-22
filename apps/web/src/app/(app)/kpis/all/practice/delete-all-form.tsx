'use client';

import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// "Delete all practice scorecards" (owner, 22 October 2026: "deletes in one click"), a Super Admin's only (owner's
// decision, 15 October 2026: only a Super Admin deletes): every practice scorecard, or only those they started ("Only
// mine"), asking first. Real scorecards are never touched: the API deletes practice ones alone.

export function DeleteAllPracticeForm({ action, total, mine }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; total: number; mine: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [onlyMine, setOnlyMine] = useState(false);
  const fid = useFieldIds();
  const count = onlyMine ? mine : total;
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const what = onlyMine ? 'the practice scorecards you started' : 'every practice scorecard';
        if (!window.confirm(`Delete ${what} (${count})? Their picks, comments and steps go with them; nothing real changes.`)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <label htmlFor={fid('mine')} className="flex min-h-11 items-center gap-2 text-sm">
        <input id={fid('mine')} type="checkbox" name="mine" value="1" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-accent" />
        Only mine
      </label>
      <button type="submit" disabled={pending || count === 0} className="btn btn-danger">
        {pending ? 'Deleting…' : 'Delete all practice scorecards'}
      </button>
      <FormErrors errors={state.errors} />
    </form>
  );
}
