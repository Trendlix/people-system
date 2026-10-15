import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS, OFFER_VALID_DAYS, PAY_BASIS_LABELS } from '@trendlix/shared';
import { DocumentViewer } from '@/components/document-viewer';
import { getBrand } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { pdfFileName, PROTECTED_PDF_HINT } from '@/lib/protected-pdf';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { OfferView } from '@/lib/types';
import { ActionButton } from '../../employees/[id]/contracts/contract-buttons';
import { addDays } from '../../employees/[id]/contracts/dates';
import { formatEgp, hourlyNetTerms } from '../../employees/[id]/contracts/salary';
import { arrangementLabel, FieldGrid, todayInCairo, type GridField } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { answerOffer, deleteOffer, emailOffer, extendOffer, hireFromOffer, linkOffer, withdrawOffer } from '../actions';
import { loadOffer } from '../data';
import { canSeeOffers, managesOffers, offerDocumentHref, placeName, shownStatus, WHO_SEES } from '../list';
import { canBeSent, documentLabels, documentState, draftTemplateVersion, missingHelp, offerTimeline, templateProblem, waitingText, type TimelineEvent } from '../timeline';
import { OfferStatusBadge } from '../ui';
import { ExtendOffer, RecordAnswer, SendOffer, WithdrawOffer } from './offer-actions';

// One job offer: what it says, where it stands (a timeline from drafted to the profile made), what filling in its
// template lacks, and what HR can do next: preview or download the PDF, edit, send it by email or copy the link,
// extend it, withdraw it, record an answer given another way, make the profile once accepted; a Super Admin deletes one
// that wasn't accepted (owner's decisions, 15 October 2026). The CEO sees all of it, without the actions. Its document
// is only ever a protected PDF, never a Word file (owner's request, 15 October 2026: "No doc file export, just a
// protected PDF"): without the server's PDF converter, it can't be made or sent (timeline.ts, documentState).

const small = 'btn min-h-9 px-3';

/**
 * Why the offer's document can't be made: the one place the page says it (the sending buttons are left out meanwhile).
 * For a draft, or a sent offer that would be sent again (`status`: as shown, so not one past its last day).
 */
function MissingValues({ offer: o, status }: { offer: OfferView; status: OfferView['status'] }) {
  const problem = templateProblem(o);
  const help = o.status === 'draft' ? missingHelp(o) : [];
  if ((status !== 'draft' && status !== 'sent') || (!problem && help.length === 0)) return null;
  return (
    <section aria-labelledby="offer-missing" role="alert" className="space-y-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      <h2 id="offer-missing" className="font-semibold">
        {problem
          ? draftTemplateVersion(o) !== null
            ? "The Offer Can't Be Sent Yet"
            : "The Offer's Document Can't Be Made Yet"
          : `The Job Offer Template Needs ${help.length === 1 ? 'One More Value' : `${help.length} More Values`}`}
      </h2>
      {problem && (
        <p>
          {problem.text} <Link href={problem.href}>Open the template</Link>
        </p>
      )}
      {help.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {help.map((m) => (
            <li key={m.tag}>
              <span className="font-semibold">{m.label}</span>: {m.what}{' '}
              {m.href && m.linkText && (
                <Link href={m.href}>
                  {m.linkText}
                  <span className="sr-only">: {m.label}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <p>{o.status === 'draft' ? 'Sending it by email or as a link waits for this.' : 'Sending it again waits for this.'}</p>
    </section>
  );
}

function candidateFields(o: OfferView): GridField[] {
  return [
    { key: 'offer-name-en', label: 'Full name in English', value: o.fullNameEn },
    { key: 'offer-name-ar', label: 'Full name in Arabic', value: o.fullNameAr, ar: true },
    { key: 'offer-email', label: 'Personal email', value: <a href={`mailto:${o.email}`}>{o.email}</a> },
    { key: 'offer-mobile', label: 'Mobile', value: o.mobile && <span className="tabular-nums">{o.mobile}</span> },
    ...(o.employee
      ? [
          {
            key: 'offer-profile',
            label: 'Profile',
            value: <Link href={`/employees/${o.employee.id}`}>{o.employee.fullNameEn}</Link>,
            note: o.hiredAt ? 'Made from this offer' : `${o.employee.employeeCode}: already has a profile`,
          },
        ]
      : []),
  ];
}

function positionFields(o: OfferView): GridField[] {
  return [
    { key: 'offer-type', label: 'Employment type', value: LABELS.employmentType[o.employmentType] ?? o.employmentType },
    { key: 'offer-place', label: 'Department or team', value: placeName(o.department) },
    {
      key: 'offer-title',
      label: 'Job title',
      value: o.jobTitle?.titleEn,
      note: o.jobTitle?.titleAr && (
        <span lang="ar" dir="rtl">
          {o.jobTitle.titleAr}
        </span>
      ),
    },
    { key: 'offer-grade', label: 'Grade', value: o.grade && `${o.grade.code} · ${o.grade.levelEn}` },
    { key: 'offer-manager', label: 'Direct manager', value: o.manager && <Link href={`/employees/${o.manager.id}`}>{o.manager.fullNameEn}</Link> },
    { key: 'offer-shift', label: 'Shift', value: o.shift && `Shift ${o.shift.code}` },
    { key: 'offer-arrangement', label: 'Work arrangement', value: arrangementLabel(o) },
    { key: 'offer-join', label: 'Join date', value: formatDate(o.joinDate) },
  ];
}

function termsFields(o: OfferView): GridField[] {
  const fields: GridField[] = [{ key: 'offer-pay-basis', label: 'Pay basis', value: PAY_BASIS_LABELS[o.payBasis] ?? o.payBasis }];
  if (!o.salaryHidden) {
    if (o.payBasis === 'hourly') {
      fields.push({
        key: 'offer-hourly',
        label: 'Hourly rate',
        value: o.hourlyRate !== null && formatEgp(o.hourlyRate),
        protected: true,
        note: [o.hoursPerWeek !== null && `${o.hoursPerWeek} hours a week`, hourlyNetTerms(o)].filter(Boolean).join(' · ') || null,
      });
    }
    fields.push(
      {
        key: 'offer-gross',
        label: o.payBasis === 'hourly' ? 'Gross (monthly estimate)' : 'Gross salary',
        value: o.grossSalary !== null && formatEgp(o.grossSalary),
        protected: true,
        note: o.basicPercent !== null && `${o.basicPercent}% basic; the variable part follows the monthly performance reports`,
      },
      {
        key: 'offer-allowances',
        label: 'Allowances',
        value:
          o.allowances && o.allowances.length > 0 ? (
            <ul>
              {o.allowances.map((a) => (
                <li key={a.allowanceTypeId}>
                  {a.nameEn}: {formatEgp(a.amount)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted">None</span>
          ),
        protected: true,
      },
      {
        key: 'offer-total',
        label: 'Gross and allowances',
        value: o.totalSalary !== null && formatEgp(o.totalSalary),
        protected: true,
        note: 'A month',
      },
      { key: 'offer-net', label: 'Net salary', value: o.netSalary !== null && formatEgp(o.netSalary), protected: true, note: 'Approximate, as calculated' },
      {
        key: 'offer-insured',
        label: 'Insured wage',
        value: o.insuredSalary !== null && formatEgp(o.insuredSalary),
        protected: true,
      },
    );
  }
  fields.push(
    { key: 'offer-days', label: 'Working days a week', value: o.daysPerWeek !== null && String(o.daysPerWeek) },
    { key: 'offer-probation', label: 'Probation', value: o.probationMonths > 0 ? `${o.probationMonths} months` : 'None' },
    { key: 'offer-duration', label: 'Contract length', value: `${o.durationMonths} months`, note: 'Fixed term, from the join date' },
  );
  return fields;
}

function offerFields(o: OfferView, open: boolean): GridField[] {
  return [
    { key: 'offer-number', label: 'Offer number', value: <span className="tabular-nums">{o.number}</span> },
    {
      key: 'offer-expires',
      label: 'Open until',
      value: formatDate(o.expiresOn),
      note: open ? 'The last day to accept' : undefined,
    },
    {
      key: 'offer-template',
      label: 'Template',
      value: o.template.name,
      note:
        o.template.status === 'published'
          ? o.template.version
            ? `Version ${o.template.version} in use`
            : 'Published'
          : o.template.status === 'draft'
            ? o.template.previewVersion !== null
              ? `Only draft v${o.template.previewVersion}: previews use it; publish it to send the offer`
              : 'Only a draft: publish it first'
            : 'Not uploaded yet',
    },
    {
      key: 'offer-document',
      label: 'Document',
      // the name of the PDF it is given out as
      value: o.document && pdfFileName(o.document.fileName),
      note: o.document ? `Dated ${formatDate(o.document.documentDate)}` : o.status === 'draft' ? 'Filled in afresh at each preview until it is sent' : undefined,
    },
  ];
}

const TONE: Record<TimelineEvent['tone'], string> = {
  ok: 'bg-ok',
  danger: 'bg-danger',
  muted: 'bg-muted/50',
  accent: 'bg-accent',
};

function Timeline({ events, waiting }: { events: TimelineEvent[]; waiting: string | null }) {
  return (
    <ol className="space-y-4">
      {events.map((e) => (
        <li key={e.key} className="flex gap-3">
          <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE[e.tone]}`} />
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-semibold">{e.label}</span> <span className="text-muted tabular-nums">· {formatDateTime(e.at)}</span>
            </p>
            {e.detail && <p className="break-words text-muted">{e.detail}</p>}
            {e.href && (
              <Link href={e.href} className="text-sm font-semibold">
                Open the profile
              </Link>
            )}
          </div>
        </li>
      ))}
      {waiting && (
        <li className="flex gap-3">
          <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-line bg-white" />
          <p className="text-sm text-muted">{waiting}</p>
        </li>
      )}
    </ol>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

type Query = Record<string, string | string[] | undefined>;

async function Offer({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!canSeeOffers(user)) return <Empty>{WHO_SEES}</Empty>;
  const offer = await loadOffer(params);
  if (!offer) return <Empty>Not available yet: the server does not have job offers yet.</Empty>;
  const o = offer;
  const brand = await getBrand();
  const today = todayInCairo();
  const status = shownStatus(o.status, o.expiresOn, today);
  // a draft past its last day can't be sent or answered until it has a later one (the API refuses it with 409)
  const pastLastDay = o.expiresOn < today;
  const answerable = (status === 'draft' || status === 'sent') && !pastLastDay;
  // why the profile couldn't be made when HR recorded the acceptance (answerOffer puts it in the address)
  const hireErrorParam = (await searchParams).hireError;
  const hireError = status === 'accepted' && !o.hiredAt && typeof hireErrorParam === 'string' ? hireErrorParam.slice(0, 500) : null;
  const manages = managesOffers(user);
  const doc = documentState(o, status);
  const labels = documentLabels(doc.draftTemplate);
  const open = status === 'draft' || status === 'sent';
  const name = `offer ${o.number}`;
  // the actions card only when it has something in it (e.g. not for the CEO on a withdrawn offer without a document)
  const hasActions = doc.pdf || Boolean(doc.why) || Boolean(o.hiredAt) || canDelete(user) || (manages && status !== 'withdrawn' && status !== 'declined');
  const mail = {
    to: o.email,
    name: o.fullNameEn,
    jobTitle: o.jobTitle?.titleEn ?? null,
    company: brand.nameEn,
    expiresOn: o.expiresOn,
    message: o.message,
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink href="/offers">Job offers</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{o.fullNameEn}</h1>
          <OfferStatusBadge status={status} />
        </div>
        <p className="text-sm text-muted">
          <span className="tabular-nums">{o.number}</span> · {o.jobTitle?.titleEn ?? LABELS.employmentType[o.employmentType]} · joining{' '}
          {formatDate(o.joinDate)}
        </p>
      </div>

      <MissingValues offer={o} status={status} />

      {status === 'accepted' && !o.hiredAt && (
        <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {hireError
            ? `The acceptance is recorded, but the profile couldn't be made: ${hireError} Fix that, then press Make the profile.`
            : "The offer is accepted, but the employee profile, employment and draft contract haven't been made yet. Press Make the profile; if it fails, it says why."}
        </p>
      )}

      {hasActions && (
        <section aria-label="Actions" className="card space-y-4 p-4 sm:px-6">
          <div className="flex flex-wrap items-start gap-3">
            {doc.pdf && (
              <>
                <DocumentViewer
                  title={`Job offer ${o.number}: ${o.fullNameEn}${doc.draftTemplate !== null ? ` (draft template v${doc.draftTemplate})` : ''}`}
                  files={[{ alt: `Job offer ${o.number}`, src: offerDocumentHref(o.id), mimeType: 'application/pdf' }]}
                  className={`${small} btn-secondary`}
                >
                  {labels.preview}
                </DocumentViewer>
                {/* a plain link, never prefetched: the web server fetches the PDF from the API with the session */}
                <a href={offerDocumentHref(o.id, true)} className={`${small} btn-secondary`}>
                  {labels.download}
                  <span className="sr-only"> ({name})</span>
                </a>
              </>
            )}
            {manages && (status === 'draft' || status === 'sent' || status === 'expired') && (
              <Link href={`/offers/${o.id}/edit`} className={`${small} btn-secondary`}>
                {status === 'draft' ? 'Edit' : 'Edit date and note'}
                <span className="sr-only"> {name}</span>
              </Link>
            )}
            {manages && (status === 'sent' || status === 'expired') && (
              <ExtendOffer action={extendOffer.bind(null, o.id)} expiresOn={o.expiresOn} suggested={addDays(o.expiresOn < today ? today : o.expiresOn, OFFER_VALID_DAYS)} />
            )}
            {manages && answerable && <RecordAnswer action={answerOffer.bind(null, o.id)} />}
            {manages && (status === 'draft' || status === 'sent' || status === 'expired') && <WithdrawOffer action={withdrawOffer.bind(null, o.id)} number={o.number} />}
            {manages && status === 'accepted' && !o.hiredAt && (
              <ActionButton action={hireFromOffer.bind(null, o.id)} pendingText="Making the profile…" variant="primary">
                Make the profile
              </ActionButton>
            )}
            {o.hiredAt && o.employeeId && (
              <Link href={`/employees/${o.employeeId}`} className={`${small} btn-primary`}>
                Open the profile
              </Link>
            )}
            {canDelete(user) && status !== 'accepted' && (
              <ActionButton
                action={deleteOffer.bind(null, o.id)}
                pendingText="Deleting…"
                variant="danger"
                confirmText={`Delete ${name} for ${o.fullNameEn}? This cannot be undone.`}
              >
                Delete<span className="sr-only"> {name}</span>
              </ActionButton>
            )}
          </div>
          {doc.pdf && <p className="text-xs text-muted">{PROTECTED_PDF_HINT}</p>}
          {doc.why && <p className="text-xs text-muted">{doc.why}</p>}
          {manages && canBeSent(o, today) && (
            <div className="border-t border-line pt-4">
              <SendOffer
                emailAction={emailOffer.bind(null, o.id)}
                linkAction={linkOffer.bind(null, o.id)}
                mail={mail}
                emailConfigured={o.emailConfigured}
                sentCount={o.sentCount}
              />
            </div>
          )}
          {manages && status === 'expired' && (
            <p className="text-sm text-muted">Extend the offer to send it again, or to record an answer the candidate gave before its last day.</p>
          )}
          {manages && status === 'draft' && pastLastDay && (
            <p className="text-sm text-warn">
              Its last day, {formatDate(o.expiresOn)}, has passed. Edit it to set a later one, then send it or record the answer.
            </p>
          )}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-8">
          <Part title="Candidate">
            <FieldGrid fields={candidateFields(o)} />
          </Part>
          <Part title="Position">
            <FieldGrid fields={positionFields(o)} />
          </Part>
          <Part title="Terms">
            {o.salaryHidden && <p className="text-sm text-muted">The pay is shown to HR, Finance and the CEO only.</p>}
            <FieldGrid fields={termsFields(o)} />
          </Part>
          <Part title="Offer">
            <FieldGrid fields={offerFields(o, open)} />
            {o.message && (
              <div className="card p-4 text-sm">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Message to the candidate</p>
                <p className="mt-1 whitespace-pre-line">{o.message}</p>
              </div>
            )}
            {o.note && (
              <div className="card p-4 text-sm">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Note for HR</p>
                <p className="mt-1 whitespace-pre-line">{o.note}</p>
              </div>
            )}
          </Part>
        </div>
        <Part title="Timeline">
          <div className="card p-4">
            <Timeline events={offerTimeline(o)} waiting={waitingText({ ...o, status })} />
          </div>
        </Part>
      </div>
    </div>
  );
}

export default function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<Loading />}>
        <Offer params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
