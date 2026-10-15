'use client';

import { useState } from 'react';
import { OFFER_ACCEPTANCE } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The candidate's answer, on the offer's page: Accept (typing their full name as on the offer and ticking that they
// accept its terms, in English and Arabic: OFFER_ACCEPTANCE) or Decline (a reason if they wish, after a confirmation).
// Once the answer went through, the page shows the thank-you instead.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function AcceptOffer({ action, nameEn, nameAr }: { action: Action; nameEn: string; nameAr: string }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} aria-labelledby={fid('title')} className="card space-y-5 p-5 sm:p-6">
      <div>
        <h2 id={fid('title')} className="text-lg font-semibold">
          Accept the Offer
        </h2>
        <p lang="ar" dir="rtl" className="text-sm text-muted">
          قبول العرض
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('name')} className="label">
          Your full name <span lang="ar">· اسمك الكامل</span>
        </label>
        <input
          id={fid('name')}
          name="name"
          required
          maxLength={150}
          autoComplete="name"
          aria-describedby={fid('name-hint')}
          defaultValue={valueOf(state, 'name', '')}
          className="input text-base"
        />
        <p id={fid('name-hint')} className="hint">
          As written on the offer: {nameEn}
          {nameAr && (
            <>
              {' '}
              or{' '}
              <span lang="ar" dir="rtl">
                {nameAr}
              </span>
            </>
          )}
          .
        </p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-canvas p-4 text-sm has-checked:border-accent has-checked:bg-accent-soft">
        <input type="checkbox" name="agree" value="yes" required className="mt-0.5 size-5 shrink-0 accent-accent" />
        <span className="space-y-2">
          <span className="block">{OFFER_ACCEPTANCE.en}</span>
          <span lang="ar" dir="rtl" className="block">
            {OFFER_ACCEPTANCE.ar}
          </span>
        </span>
      </label>
      <SubmitButton busy={pending} pendingText="Accepting…">
        Accept the offer
      </SubmitButton>
    </form>
  );
}

export function DeclineOffer({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="text-center">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-secondary">
          Decline the offer
        </button>
      </div>
    );
  }
  return (
    <form
      {...form}
      onSubmit={(e) => {
        if (!window.confirm('Decline this job offer? Once declined, it can no longer be accepted from this page.')) {
          e.preventDefault();
          return;
        }
        form.onSubmit(e);
      }}
      aria-labelledby={fid('title')}
      className="card space-y-4 p-5 sm:p-6"
    >
      <div>
        <h2 id={fid('title')} className="text-lg font-semibold">
          Decline the Offer
        </h2>
        <p lang="ar" dir="rtl" className="text-sm text-muted">
          الاعتذار عن العرض
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={fid('reason')}
          name="reason"
          rows={3}
          maxLength={1000}
          aria-describedby={fid('reason-hint')}
          defaultValue={valueOf(state, 'reason', '')}
          className="input text-base"
        />
        <p id={fid('reason-hint')} className="hint">
          If you&apos;d like to tell us why. It helps us, but you don&apos;t have to.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-danger">
          {pending ? 'Declining…' : 'Decline the offer'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
