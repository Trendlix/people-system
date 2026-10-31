import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DocumentViewer } from '@/components/document-viewer';
import { formatDate } from '@/lib/format';
import type { PhotoRequest } from '@/lib/types';
import { mustReview, reviewHref } from '../../confirmation';
import { loadEmployee } from '../../data';
import { cancelPhotoRequest, sendPhotoRequest } from '../../photo-request-actions';
import { pendingPhoto, photoOutcome, sentPhotoSrc } from '../../photo-requests';
import { Avatar, EditHeading, Loading, photoHref } from '../../ui';
import { CancelPhotoForm } from './cancel-photo';
import { PhotoForm } from './photo-form';

// The employee's own photo (owner, 31 October 2026: "allow them to upload a new photo as a request and approved from the
// HR"): the picture beside their name now, and a new one sent to HR, which becomes it once HR (or an Admin; a C-level
// person's, the CEO or a Super Admin) approves it. One waits at a time; they may cancel it until HR decides. Below, what
// happened to the last ones, with HR's note. Only for the employee themself (the API checks this again); open during the
// review at sign-in too, which leads here.

const DONE: Record<string, string> = {
  sent: 'Your new photo was sent to HR. It becomes your picture once HR approves it.',
  cancelled: 'Your new photo was cancelled.',
};

function Waiting({ request: r, employeeId }: { request: PhotoRequest; employeeId: string }) {
  return (
    <section className="card space-y-4 p-6" aria-labelledby="photo-waiting">
      <h2 id="photo-waiting" className="font-semibold">
        Waiting for HR
      </h2>
      <div className="flex flex-wrap items-center gap-5">
        <DocumentViewer title="Your New Photo" files={[{ alt: 'The new photo you sent', src: sentPhotoSrc(r.id) }]} className="shrink-0 cursor-zoom-in rounded-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- a photo behind the session: not for the image optimizer */}
          <img src={sentPhotoSrc(r.id)} alt="The new photo you sent" className="size-28 rounded-full border border-line object-cover" />
        </DocumentViewer>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p>
            Sent <span className="font-medium">{formatDate(r.requestedAt)}</span>. HR decides whether it becomes your picture; you can send another
            once they have, or cancel this one to send a different photo.
          </p>
          {r.note && <p className="whitespace-pre-line text-muted">Your note: {r.note}</p>}
        </div>
      </div>
      <CancelPhotoForm action={cancelPhotoRequest.bind(null, employeeId, r.id)} />
    </section>
  );
}

/** The page's address: the employee, and what was just done (?sent=1, ?cancelled=1). */
interface Address {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function Photo({ params, searchParams }: Address) {
  const [p, query] = await Promise.all([loadEmployee(params), searchParams]);
  if (!p.isSelf) redirect(`/employees/${p.id}`);
  const requests = p.photoRequests ?? [];
  const waiting = pendingPhoto(requests);
  const closed = requests.filter((r) => r.status !== 'pending');
  const doneKey = query.sent === '1' ? 'sent' : query.cancelled === '1' ? 'cancelled' : undefined;
  // reached from the review at sign-in, which the profile would send them back to
  const back = mustReview(p.confirmation, p.changeRequests) ? reviewHref(p.id) : undefined;

  return (
    <>
      <EditHeading profile={p} title="Your Photo" backHref={back} />

      {doneKey && (
        <p role="status" className="max-w-3xl rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {DONE[doneKey]}
        </p>
      )}

      <section className="card flex max-w-3xl flex-wrap items-center gap-5 p-6" aria-labelledby="photo-now">
        {p.photoId ? (
          <DocumentViewer title="Your Photo" files={[{ alt: 'Your personal photo', src: photoHref(p.photoId) }]} className="shrink-0 cursor-zoom-in rounded-full">
            <Avatar name={p.fullNameEn} photoId={p.photoId} crop={p.photoCrop} size="lg" />
            <span className="sr-only">View your photo</span>
          </DocumentViewer>
        ) : (
          <Avatar name={p.fullNameEn} size="lg" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="photo-now" className="font-semibold">
            Your Picture Now
          </h2>
          <p className="text-sm text-muted">
            {p.photoId
              ? 'The personal photo in your employee file, shown beside your name across People. HR may crop it to show your face.'
              : 'There is no personal photo in your employee file yet, so your initials are shown beside your name.'}
          </p>
        </div>
      </section>

      <div className="max-w-3xl">
        {waiting ? <Waiting request={waiting} employeeId={p.id} /> : <PhotoForm action={sendPhotoRequest.bind(null, p.id)} />}
      </div>

      {closed.length > 0 && (
        <section className="max-w-3xl space-y-3 pt-2">
          <h2 className="font-semibold">Your Earlier Photos</h2>
          <ul className="space-y-3">
            {closed.map((r) => {
              const outcome = photoOutcome(r);
              return (
                <li key={r.id} className="card space-y-1 p-4 text-sm">
                  <p>{outcome?.title}</p>
                  {outcome?.note && <p className="whitespace-pre-line text-muted">HR&apos;s note: {outcome.note}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

export default function PhotoPage({ params, searchParams }: Address) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <Photo params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
