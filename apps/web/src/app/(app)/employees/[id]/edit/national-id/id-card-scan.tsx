'use client';

import { startTransition, useState } from 'react';
import { DocumentViewer, type ViewerFile } from '@/components/document-viewer';
import type { EmployeeIdentity, FormState, IdCardScan } from '@/lib/types';
import { CardReadStatus, CardTextDetails } from '../../../id-card';
import { idScanTitle, paperworkHref, type IdScanState } from '../../../paperwork';
import { IdScan } from '../../../scan/id-scan';
import { NationalIdForm, type CardProfile } from './national-id-form';

// The national ID edit page: the ID scan (see scan/id-scan.tsx), above the national ID form its reading fills in. What
// the card says stays in this page (never in a URL) until HR checks it and saves.

/** A stored side of the card, as the document viewer shows it. */
const side = (itemId: string, label: 'Front' | 'Back'): ViewerFile => ({ label, alt: `${label} of the national ID card`, src: paperworkHref(itemId) });

export function NationalIdEditor({
  saveAction,
  scanAction,
  employeeId,
  name,
  identity,
  profile,
}: {
  saveAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  scanAction: (fd: FormData) => Promise<IdScanState>;
  employeeId: string;
  /** The employee's name (English), for the document viewer's title. */
  name: string;
  identity: EmployeeIdentity;
  profile: CardProfile;
}) {
  const [scan, setScan] = useState<IdCardScan>();

  /** Reads the two sides cut out of the scan; the API keeps them in the employee file. */
  async function read(cards: { front: File; back: File }): Promise<string[] | undefined> {
    const fd = new FormData();
    fd.append('front', cards.front, cards.front.name);
    fd.append('back', cards.back, cards.back.name);
    const result = await scanAction(fd);
    if (!result.scan) return result.errors ?? ['The card could not be read. Please try again.'];
    const got = result.scan;
    startTransition(() => setScan(got));
  }

  return (
    <>
      <section className="card max-w-2xl p-6">
        <h2 className="font-semibold">Fill from the ID Card</h2>
        <p className="mt-1 text-sm text-muted">
          Scan the card, front and back. The card is found on the scan, cut out and set straight; check both sides, then read them, and the
          national ID details below are filled in for you to check. Nothing changes until you save. The cut-out card is kept in the employee file.
        </p>

        <div className="mt-4">
          <IdScan onRead={read} name={name} />
        </div>

        {scan && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <CardReadStatus suggestions={scan.suggestions} notes={scan.notes} />
            {/* The stored photos, loaded only when opened: each download of a national ID scan is written to the audit log. */}
            <DocumentViewer
              title={idScanTitle({ front: true, back: Boolean(scan.back) }, name)}
              files={[side(scan.front.itemId, 'Front'), ...(scan.back ? [side(scan.back.itemId, 'Back')] : [])]}
            >
              {scan.back ? 'View the front and back' : 'View the front'}
            </DocumentViewer>
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
        corrected={scan?.corrected}
        profile={profile}
      />
    </>
  );
}
