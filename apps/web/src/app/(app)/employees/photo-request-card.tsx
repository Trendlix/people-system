import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { DocumentViewer } from '@/components/document-viewer';
import { formatDateTime } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import type { PhotoRequest } from '@/lib/types';
import { ChangeRequestStatusBadge } from './[id]/change-request/request-parts';
import { photoDecisionView, sentPhotoSrc } from './photo-requests';
import { profileHref } from './tab-list';
import { photoHref } from './ui';

// A new photo an employee sent HR (owner, 31 October 2026: "allow them to upload a new photo as a request and approved
// from the HR"), as those who decide it see it (Approvals, Details Changes): whose it is, when it was sent, the employee's
// note, the photo (larger in a window), the picture beside their name now beside it for those who see the employee file,
// then `children`: the decide buttons, or who decided and why.

const PICTURE = 'size-24 rounded-full border border-line object-cover';

/** A photo shown round, opening larger in a window. */
function Picture({ src, label, title }: { src: string; label: string; title: string }) {
  return (
    <figure className="space-y-1.5 text-center">
      <DocumentViewer title={title} files={[{ alt: label, src }]} className="cursor-zoom-in rounded-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- a photo behind the session: not for the image optimizer */}
        <img src={src} alt={label} className={PICTURE} />
      </DocumentViewer>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

export function PhotoRequestCard({ request: r, children }: { request: PhotoRequest; children?: React.ReactNode }) {
  const name = r.employee.fullNameEn;
  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={profileHref(r.employee.id)}>{name}</Link>
            {shownCode(r.employee.employeeCode) && <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>}
            {r.confidential && <CLevelBadge className="ml-2 align-middle" title="The CEO or a Super Admin decides a C-level person’s new photo, not HR." />}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            Sent {formatDateTime(r.requestedAt)}
            {r.requestedBy?.email && <> by {r.requestedBy.email}</>}
          </p>
        </div>
        <ChangeRequestStatusBadge status={r.status} confidential={r.confidential} />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <Picture src={sentPhotoSrc(r.id)} label="New photo" title={`New Photo · ${name}`} />
        {r.currentPhotoId && r.status === 'pending' && <Picture src={photoHref(r.currentPhotoId)} label="Now" title={`Personal Photo · ${name}`} />}
      </div>
      {r.note && (
        <div className="mt-4 text-sm">
          <p className="text-xs text-muted">Their note</p>
          <p className="mt-0.5 whitespace-pre-line">{r.note}</p>
        </div>
      )}
      {children}
    </li>
  );
}

/** Who decided a closed request and when, and the note given with it; cancelled, by the employee. */
export function PhotoDecision({ request }: { request: PhotoRequest }) {
  const d = photoDecisionView(request);
  if (!d) return null;
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted">Decision</dt>
        <dd className="mt-0.5 font-medium">{d.title}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">When</dt>
        <dd className="mt-0.5">{d.at ?? <span className="text-muted">—</span>}</dd>
      </div>
      {d.note && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Note</dt>
          <dd className="mt-0.5 whitespace-pre-line">{d.note}</dd>
        </div>
      )}
    </dl>
  );
}
