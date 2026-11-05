import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { canWithdrawResignation, RESIGNATION_CONFIRMATION, RESIGNATION_LETTER_NO_TEMPLATE } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ResignationRequestView } from '@/lib/resignation-types';
import { UploadSignedCopy } from '../../employees/[id]/documents/document-forms';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { returnResignation, uploadResignationLetter, withdrawResignation } from '../actions';
import { loadResignation } from '../data';
import { ReturnForm, WithdrawButton } from '../forms';
import { generatedLetterHref, MY_RESIGNATION_HREF, recordResignationHref, RESIGNATIONS_PATH, signedLetterHref, type ResignationDone } from '../resignation';
import { ResignationStatusBadge } from '../ui';
import { profileHref } from '../../employees/ui';

// A resignation request (owner, 26 October 2026: "but the employee has to request resignation and then the HR generates
// the document"): its reason, the preferred day, the notice day and the rule's last day. For its employee, with Withdraw
// while it waits; for HR (the CEO for a C-level person), with "Record the resignation" and Return; for the direct
// manager, what was sent and where it stands, without the reason and the letters. Nothing here decides for the manager.
// The letter (owner, 31 October 2026: "on the resignation, the letter is auto generated ... uploaded by the HR"; 5 November
// 2026: "make the HR generate the templete not the employee"): HR (the CEO for a C-level person) generates People's from
// the request, to print for signing, and uploads the signed copy. The employee only applies: the API sends them neither.

export const metadata: Metadata = { title: 'Resignation Request · People System' };

const DONE: Record<ResignationDone, string> = {
  sent: 'Resignation request sent.',
  withdrawn: 'Request withdrawn.',
  returned: 'Request returned.',
  moved: 'This request changed meanwhile.',
};

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** The letter HR generates from the request, to view or save, and the signed copy HR uploads: HR's and the CEO's. */
function Letter({ r }: { r: ResignationRequestView }) {
  return (
    <div className="card mt-4 space-y-4 p-5">
      <h2 className="text-lg font-semibold">Resignation Letter</h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Item label="Letter">
          {r.preparedLetter === 'ready' ? (
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <a href={generatedLetterHref(r.id)} target="_blank" rel="noreferrer" className="font-semibold">
                Generate letter
              </a>
              <a href={generatedLetterHref(r.id, true)} className="font-semibold">
                Download PDF
              </a>
            </span>
          ) : (
            <span className="text-muted">{RESIGNATION_LETTER_NO_TEMPLATE}</span>
          )}
        </Item>
        <Item label="Signed Copy">
          {r.letter ? (
            <a href={signedLetterHref(r.id)} target="_blank" rel="noreferrer" className="font-semibold">
              {r.letter.letterFileName}
            </a>
          ) : (
            <span className="text-muted">Not uploaded yet</span>
          )}
        </Item>
      </dl>
      {r.canUploadLetter && <UploadSignedCopy action={uploadResignationLetter.bind(null, r.id)} name="the resignation letter" again={r.letter !== null} />}
    </div>
  );
}

async function Request({ params, searchParams }: { params: PageProps<'/resignations/[id]'>['params']; searchParams: PageProps<'/resignations/[id]'>['searchParams'] }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadResignation(id);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{notLoadedText(loaded, 'resignation request')}</Empty>;
  const r = loaded.value;
  const done = typeof query.done === 'string' && query.done in DONE ? DONE[query.done as ResignationDone] : null;
  const back = r.mine ? { href: MY_RESIGNATION_HREF, label: 'My Requests' } : { href: RESIGNATIONS_PATH, label: 'Resignations' };
  const decides = r.canRecord === true && r.status === 'sent';
  return (
    <>
      <BackLink href={back.href}>{back.label}</BackLink>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Resignation Request</h1>
          <p className="text-muted">{r.mine ? 'Your request' : r.employee.fullNameEn}</p>
        </div>
        <ResignationStatusBadge r={r} />
      </div>
      {done && (
        <p role="status" className="mt-4 rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      <div className="card mt-4 space-y-4 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Item label="Notice Received On">{formatDate(r.sentOn)}</Item>
          <Item label="Last Working Day By The Rule">
            {formatDate(r.ruleLastDay)} <span className="text-muted">({r.notice} from the notice day)</span>
          </Item>
          <Item label="Preferred Last Working Day">{r.preferredLastDay ? formatDate(r.preferredLastDay) : <span className="text-muted">None given</span>}</Item>
          <Item label="Sent">{formatDateTime(r.createdAt)}</Item>
          {r.reason !== null && (
            <Item label="Reason" wide>
              <span className="whitespace-pre-line">{r.reason}</span>
            </Item>
          )}
          {r.returned && (
            <Item label="Returned" wide>
              {r.returned.at && <>{formatDateTime(r.returned.at)} · </>}
              {r.returned.reason ? <span className="whitespace-pre-line">{r.returned.reason}</span> : 'with a reason for the employee'}
            </Item>
          )}
          {r.withdrawnAt && <Item label="Withdrawn">{formatDateTime(r.withdrawnAt)}</Item>}
          {r.recorded && (
            <Item label="Recorded" wide>
              {r.recorded.at && formatDateTime(r.recorded.at)}
              {!r.mine && r.recorded.endingId && (
                <>
                  {' · '}
                  <Link href={profileHref(r.employee.id, 'employment')}>See the ending on the Employment tab</Link>
                </>
              )}
            </Item>
          )}
        </dl>
        <p className="text-xs text-muted">{RESIGNATION_CONFIRMATION}</p>
      </div>
      {r.preparedLetter !== null && <Letter r={r} />}
      {r.mine && canWithdrawResignation(r.status) && (
        <div className="mt-4">
          <WithdrawButton action={withdrawResignation.bind(null, r.id)} />
        </div>
      )}
      {decides && (
        <div className="card mt-4 space-y-4 p-5">
          <h2 className="text-lg font-semibold">Record Or Return</h2>
          <Link href={recordResignationHref(r.employee.id, r.id)} className="btn btn-primary inline-block">
            Record the resignation
          </Link>
          <div className="border-t border-line pt-4">
            <ReturnForm action={returnResignation.bind(null, r.id)} />
          </div>
        </div>
      )}
    </>
  );
}

export default function ResignationPage({ params, searchParams }: PageProps<'/resignations/[id]'>) {
  return (
    <div>
      <Suspense fallback={<Loading />}>
        <Request params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
