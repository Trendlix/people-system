'use client';

import Link from 'next/link';
import { startTransition, useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { EmployeeIdentity, FormState } from '@/lib/types';
import { CardReadStatus, CardTextDetails } from '../../../id-card';
import { FILE_INPUT, limitFileSize, paperworkHref, PHOTO_ACCEPT, type IdScanState } from '../../../paperwork';
import { withSmallerPhotos } from '../../../shrink-photo';
import { NationalIdForm, type CardProfile } from './national-id-form';

// The national ID edit page: a box that reads photos of the ID card, above the national ID form it fills in.
// What the card says stays in this page (never in a URL) until HR checks it and saves.

const viewLink = 'inline-flex min-h-9 items-center text-sm font-semibold';

export function NationalIdEditor({
  saveAction,
  scanAction,
  employeeId,
  identity,
  profile,
}: {
  saveAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  scanAction: (prev: IdScanState, fd: FormData) => Promise<IdScanState>;
  employeeId: string;
  identity: EmployeeIdentity;
  profile: CardProfile;
}) {
  const [state, formAction, reading] = useActionState(scanAction, {});
  const fid = useFieldIds();

  // the photos are made smaller first (see shrink-photo.ts), then sent
  async function read(fd: FormData) {
    const ready = await withSmallerPhotos(fd, ['front', 'back']);
    startTransition(() => formAction(ready));
  }
  const scan = state.scan;

  return (
    <>
      <section className="card max-w-2xl p-6">
        <h2 className="font-semibold">Fill from ID Card Photos</h2>
        <p className="mt-1 text-sm text-muted">
          The photos are read and the national ID details below are filled in for you to check. Nothing changes until you save. The photos are
          kept in the employee file.
        </p>

        <form action={read} className="mt-4 space-y-4">
          <FormErrors errors={state.errors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('front')} className="label">
                Front of the card
              </label>
              <input id={fid('front')} name="front" type="file" accept={PHOTO_ACCEPT} required onChange={limitFileSize} className={FILE_INPUT} />
            </div>
            <div>
              <label htmlFor={fid('back')} className="label">
                Back of the card <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id={fid('back')} name="back" type="file" accept={PHOTO_ACCEPT} onChange={limitFileSize} className={FILE_INPUT} />
            </div>
          </div>
          <p className="hint">JPEG, PNG or WebP, up to 10 MB each. A sharp, straight photo in good light reads best. The back gives the dates and the issuing office.</p>
          <SubmitButton pendingText="Reading the card…" busy={reading}>
            Read the card
          </SubmitButton>
        </form>

        {scan && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <CardReadStatus suggestions={scan.suggestions} />
            <div className="flex flex-wrap gap-x-4">
              {/* Never prefetched: each download of a national ID scan is written to the audit log. */}
              <Link href={paperworkHref(scan.front.itemId)} prefetch={false} target="_blank" rel="noopener" className={viewLink}>
                View the front photo<span className="sr-only"> (opens in a new tab)</span>
              </Link>
              {scan.back && (
                <Link href={paperworkHref(scan.back.itemId)} prefetch={false} target="_blank" rel="noopener" className={viewLink}>
                  View the back photo<span className="sr-only"> (opens in a new tab)</span>
                </Link>
              )}
            </div>
            <CardTextDetails front={scan.front.text} back={scan.back?.text ?? null} />
          </div>
        )}
      </section>

      {/* A new reading starts the form again from what the card says. */}
      <NationalIdForm
        key={scan?.front.itemId ?? 'manual'}
        action={saveAction}
        employeeId={employeeId}
        identity={identity}
        suggestions={scan?.suggestions}
        profile={profile}
      />
    </>
  );
}
