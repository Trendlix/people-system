import Link from 'next/link';
import { employeeRaiseRequestsHref } from '../employees/ui';
import { askedAt, raiseRequestAnchor } from '../raise-requests/list';
import { EffectiveFrom, FoldedRequestLog, PreparedRaise, Progress, RaiseRequestStatusBadge, RequestReason, Requester, Suggestion } from '../raise-requests/ui';
import { requestTitle, type MyRequest } from './requests';

// A raise request on My Requests (owner, 17 October 2026), and its page on the phone pages (owner, 20 October 2026: the
// employee app): the same card.

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * A raise they asked for (or, for a manager, asked for for a direct report): the reason from the list and the comment,
 * the raise suggested, the raise prepared, where it stands, and its log of every step (owner, 17 October 2026), each as
 * the API shapes it for the viewer.
 */
export function RaiseCard({
  item,
  link,
}: {
  item: Extract<MyRequest, { kind: 'raise' | 'team' }>;
  /** Where it opens: the profile's raise requests (the default); none on the phone pages, where this is its page. */
  link?: { href: string; label: string } | null;
}) {
  const r = item.request;
  const open = link === undefined ? { href: employeeRaiseRequestsHref(r.employee.id), label: item.kind === 'team' ? `Open ${r.employee.fullNameEn}'s raise requests` : 'Open on my profile' } : link;
  return (
    <li id={raiseRequestAnchor(r.id)} className="card scroll-mt-6 space-y-4 p-5 target:ring-2 target:ring-accent">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{requestTitle(item)}</h3>
          <p className="text-sm text-muted">Asked {askedAt(r)}</p>
        </div>
        <RaiseRequestStatusBadge status={r.status} confidential={r.confidential} />
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Item label="Asked by">
          <Requester request={r} />
        </Item>
        <Item label="Effective from">
          <EffectiveFrom request={r} />
        </Item>
        {/* the raise suggested, as far as the API lets the viewer see it (a manager: a percent only) */}
        {(r.suggestion || r.suggestedGross !== null) && (
          <Item label="Suggested raise">
            <Suggestion request={r} />
          </Item>
        )}
        <Item label="Why" wide>
          <RequestReason request={r} />
        </Item>
        {r.raise && (
          <Item label="The raise">
            <PreparedRaise request={r} />
          </Item>
        )}
        <Item label="Where it stands">
          <Progress request={r} />
        </Item>
      </dl>
      {/* every step, as the request logs it (owner, 17 October 2026: "all the request steps to be logged in the request") */}
      <FoldedRequestLog request={r} />
      {open && (
        <Link href={open.href} className="inline-block text-sm font-semibold">
          {open.label}
        </Link>
      )}
    </li>
  );
}
