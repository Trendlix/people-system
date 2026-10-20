import Link from 'next/link';
import { homeStatusLabel, type HomeStatus } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { LocationsMap } from '@/components/map/maps';
import { formatDateTime } from '@/lib/format';
import type { HomeLocationView } from '@/lib/home-location-types';
import { homeCircle, homeLocationHref, homeMapLabel, homeProgressText, homesLabel, homeStepText, homeStepTone, homeWhatText } from './home-locations';

// Parts of a home location request (owner, 20 October 2026: "allow other users to request to add their home locations
// when working from home"), shown on its page, on My Requests, on Approvals, on Check-in Setup and on a profile: its
// status, where it stands with a rejection's comment, its point on a small map with the radius's circle (only while it is
// kept: the point is deleted once rejected, withdrawn, replaced or removed), its log of every step, and the employee's
// table of theirs. No hooks: the map is the shared one (components/map), loaded in the browser.

const STATUS_BADGE: Record<HomeStatus, string> = {
  with_hr: 'bg-warn-soft text-warn',
  with_ceo: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  withdrawn: 'bg-line-soft text-muted',
  replaced: 'bg-line-soft text-muted',
  removed: 'bg-line-soft text-muted',
};

/** With HR, With the CEO, Approved, Rejected, Withdrawn, Replaced or Removed; a C-level person's with HR: With the CEO. */
export function HomeStatusBadge({ status, confidential }: { status: HomeStatus; confidential?: boolean }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{homeStatusLabel(status, confidential)}</span>;
}

/** Where it stands, with the comment of a rejection. */
export function HomeProgress({ request }: { request: HomeLocationView }) {
  const p = homeProgressText(request);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

/** The home's point and its radius's circle on a small map (`radiusMetres`: another radius, e.g. while HR types one); a line once the point is deleted. */
export function HomeMap({ request, radiusMetres, own = false, height = 'h-[200px]' }: { request: HomeLocationView; radiusMetres?: number; own?: boolean; height?: string }) {
  const circle = homeCircle(request, radiusMetres);
  if (!circle) return <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Its point is deleted: it is no longer kept.</p>;
  return <LocationsMap circles={[circle]} label={homeMapLabel({ ...request, radiusMetres: circle.radiusMetres }, own)} height={height} />;
}

const DOT: Record<'ok' | 'danger' | 'none', string> = { ok: 'bg-ok', danger: 'bg-danger', none: 'bg-line' };

/** Every step, in the order taken, with who and when. */
export function HomeTimeline({ request }: { request: Pick<HomeLocationView, 'steps' | 'confidential'> }) {
  const steps = request.steps ?? [];
  if (!steps.length) return <p className="text-sm text-muted">No steps logged yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-line-soft pl-4" aria-label={`Every step of the request, ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}>
      {steps.map((s) => (
        <li key={s.id} className="relative">
          <span aria-hidden="true" className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-card ${DOT[homeStepTone(s) ?? 'none']}`} />
          <p className="text-sm font-medium">{homeStepText(s, request.confidential)}</p>
          {s.comment && <p className="mt-0.5 text-sm whitespace-pre-line">“{s.comment}”</p>}
          <p className="text-xs text-muted">
            {s.actor && <span className="break-words">{s.actor} · </span>}
            {formatDateTime(s.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The employee's own requests, newest first: what, where it stands, opening each one's page. */
export function MyHomesTable({ requests, note }: { requests: readonly HomeLocationView[]; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Home</th>
            <th scope="col">Where It Stands</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="min-w-40">
                {homeWhatText(r)}
                <div className="mt-1 text-xs text-muted">Sent {formatDateTime(r.createdAt)}</div>
              </td>
              <td className="min-w-48">
                <HomeProgress request={r} />
              </td>
              <td>
                <HomeStatusBadge status={r.status} confidential={r.confidential} />
                {r.confidential && <CLevelBadge title="A C-level person: the CEO decides it." className="mt-1" />}
              </td>
              <td className="text-right">
                <Link href={homeLocationHref(r.id)} className="btn btn-secondary min-h-9 px-3 no-underline">
                  Open<span className="sr-only"> the home location request sent {formatDateTime(r.createdAt)}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {homesLabel(requests.length)}, {note}
      </p>
    </div>
  );
}
