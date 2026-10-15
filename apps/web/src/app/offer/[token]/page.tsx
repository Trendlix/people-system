import Image from 'next/image';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { logoUrl } from '@/components/brand';
import { getBrand } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { publicGet } from '@/lib/public-api';
import type { CompanyBrand, PublicOffer } from '@/lib/types';
import { acceptOffer, declineOffer } from './actions';
import { AcceptOffer, DeclineOffer } from './candidate-answer';
import { shownStatus } from '../../(app)/offers/list';
import { candidateView, isOfferToken } from './candidate';

// The candidate's page of a job offer (owner's request, 15 October 2026): opened from the link HR sends, with no account
// and no sign-in (proxy.ts lets /offer/... through; the token in the link is the key). It shows the company, the
// position and start date, how long the offer is open, HR's message and the offer itself (its PDF in the page, or the
// file to download), then Accept and Decline. Once answered, withdrawn or past its last day, it says so instead. English
// first, with the Arabic names and a few Arabic words beside them. Made for a phone first.

type Brand = Pick<CompanyBrand, 'logoVersion'> & { nameEn: string; nameAr: string | null };

function CompanyHeader({ brand }: { brand: Brand }) {
  return (
    <header className="mb-6 flex items-center gap-3 sm:mb-8">
      {brand.logoVersion !== null ? (
        <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg border border-line bg-white">
          <Image src={logoUrl(brand.logoVersion)} alt="" fill unoptimized className="object-contain p-1" />
        </span>
      ) : (
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sidebar text-xl font-bold text-white">
          {brand.nameEn.trim().charAt(0).toUpperCase() || '·'}
        </span>
      )}
      <div className="min-w-0 leading-tight">
        <p className="truncate text-lg font-semibold">{brand.nameEn}</p>
        {brand.nameAr && (
          <p lang="ar" dir="rtl" className="truncate text-sm text-muted">
            {brand.nameAr}
          </p>
        )}
      </div>
    </header>
  );
}

/** A short page for an offer that can't be answered (any more), and why. */
function Notice({ brand, title, titleAr, children }: { brand: Brand | null; title: string; titleAr?: string; children: React.ReactNode }) {
  return (
    <>
      {brand && <CompanyHeader brand={brand} />}
      <section className="card space-y-3 p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {titleAr && (
          <p lang="ar" dir="rtl" className="text-muted">
            {titleAr}
          </p>
        )}
        <div className="space-y-3 text-sm leading-relaxed">{children}</div>
      </section>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // each cell draws its right and bottom lines, pulled under its neighbours' and the frame's (as the profile's field grid)
    <div className="-mr-px -mb-px min-w-0 border-r border-b border-line px-4 py-3">
      <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

/** The offer itself: its PDF in the page with a download link, or just the file to download. */
function OfferDocument({ token, offer }: { token: string; offer: PublicOffer }) {
  const src = `/offer/${encodeURIComponent(token)}/document`;
  if (!offer.document) return null;
  if (!offer.document.hasPdf) {
    return (
      <section aria-labelledby="offer-document" className="card space-y-3 p-5 sm:p-6">
        <h2 id="offer-document" className="font-semibold">
          The Offer
        </h2>
        <p className="text-sm text-muted">The offer is a Word file. Download it to read it before you answer.</p>
        <a href={src} className="btn btn-primary">
          Download the offer
        </a>
      </section>
    );
  }
  return (
    <section aria-labelledby="offer-document" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="offer-document" className="font-semibold">
          The Offer
        </h2>
        <a href={`${src}?download=1`} className="btn btn-secondary min-h-9 px-3">
          Download PDF
        </a>
      </div>
      <iframe src={src} title={`Job offer ${offer.number}`} className="h-[70dvh] min-h-96 w-full rounded-xl border border-line bg-white" />
      <p className="text-xs text-muted">
        If the offer doesn&apos;t show above (some phones show only its first page),{' '}
        <a href={src} target="_blank" rel="noopener noreferrer">
          open it in a new tab
        </a>{' '}
        or download it.
      </p>
    </section>
  );
}

async function CandidateOffer({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // a link replaced by a newer one, a withdrawn offer's (its link is cleared), or one not copied in full
  const invalid = (brand: Brand | null, said?: string) => (
    <Notice brand={brand} title="This link isn't valid" titleAr="هذا الرابط غير صالح">
      {said && <p>{said}</p>}
      <p>Please open the latest link you received, or contact the HR team who sent it. A link that wasn&apos;t copied in full doesn&apos;t work either.</p>
    </Notice>
  );
  if (!isOfferToken(token)) return invalid(null);

  const [result, logo] = await Promise.all([publicGet<PublicOffer>(`/offers/${encodeURIComponent(token)}`), getBrand()]);
  if (!result.ok) {
    if (result.status === 404) return invalid(null, result.messages.find((m) => !/^Cannot GET /.test(m)));
    return (
      <Notice brand={null} title="The offer can't be shown right now">
        <p>Please try again in a few minutes.</p>
        <p className="text-xs text-muted">{result.messages.join(' ')}</p>
      </Notice>
    );
  }
  const o = result.data;
  const brand: Brand = { nameEn: o.companyNameEn || logo.nameEn, nameAr: o.companyNameAr ?? logo.nameAr, logoVersion: logo.logoVersion };
  const firstName = o.fullNameEn.trim().split(/\s+/)[0] ?? o.fullNameEn;

  // a sent offer past its last day (in Cairo) is expired, whether or not the API has said so yet
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  switch (candidateView(shownStatus(o.status, o.expiresOn, today))) {
    case 'invalid':
      return invalid(brand);
    case 'accepted':
      return (
        <Notice brand={brand} title={`Thank you, ${firstName}!`} titleAr="شكراً لك">
          <p>
            You accepted the offer{o.jobTitleEn ? ` for ${o.jobTitleEn}` : ''}
            {o.respondedAt && ` on ${formatDate(o.respondedAt)}`}
            {o.acceptedName && <>, as “{o.acceptedName}”</>}. Welcome to {brand.nameEn}.
          </p>
          <p>The HR team will be in touch about your first day, {formatDate(o.joinDate)}, and the papers to bring.</p>
        </Notice>
      );
    case 'declined':
      return (
        <Notice brand={brand} title="You declined this offer" titleAr="تم الاعتذار عن العرض">
          <p>
            You declined the offer{o.respondedAt && ` on ${formatDate(o.respondedAt)}`}. Thank you for letting us know, {firstName}, and we wish you all
            the best.
          </p>
        </Notice>
      );
    case 'withdrawn':
      return (
        <Notice brand={brand} title="This offer has been withdrawn" titleAr="تم سحب هذا العرض">
          <p>It can no longer be accepted. If you have any questions, please contact the HR team at {brand.nameEn}.</p>
        </Notice>
      );
    case 'expired':
      return (
        <Notice brand={brand} title="This offer has expired" titleAr="انتهت صلاحية هذا العرض">
          <p>
            It was open until {formatDate(o.expiresOn)}. If you are still interested, please contact the HR team at {brand.nameEn}: they can extend it.
          </p>
        </Notice>
      );
  }

  return (
    <>
      <CompanyHeader brand={brand} />
      <div className="space-y-6">
        <section aria-labelledby="offer-title" className="card space-y-5 p-5 sm:p-8">
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">Job offer · {o.number}</p>
            <h1 id="offer-title" className="text-2xl font-semibold">
              Job offer for {o.fullNameEn}
            </h1>
            <p lang="ar" dir="rtl" className="text-muted">
              عرض عمل مقدم إلى {o.fullNameAr}
            </p>
          </div>
          <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-line bg-canvas sm:grid-cols-2">
            <Fact label="Position">
              {o.jobTitleEn ?? LABELS.employmentType[o.employmentType]}
              {o.jobTitleAr && (
                <span lang="ar" dir="rtl" className="block text-muted">
                  {o.jobTitleAr}
                </span>
              )}
            </Fact>
            <Fact label="Employment type">{LABELS.employmentType[o.employmentType] ?? o.employmentType}</Fact>
            <Fact label="Start date">{formatDate(o.joinDate)}</Fact>
            <Fact label="Open until">
              <span className="font-semibold">{formatDate(o.expiresOn)}</span>
            </Fact>
          </dl>
          {o.message && <p className="text-sm leading-relaxed whitespace-pre-line">{o.message}</p>}
        </section>

        <OfferDocument token={token} offer={o} />

        <AcceptOffer action={acceptOffer.bind(null, token)} nameEn={o.fullNameEn} nameAr={o.fullNameAr} />
        <DeclineOffer action={declineOffer.bind(null, token)} />
        <p className="text-center text-xs text-muted">
          Your answer is recorded with the date, time and device it is sent from. Questions? Reply to the email the offer came in, or contact the HR team at{' '}
          {brand.nameEn}.
        </p>
      </div>
    </>
  );
}

export default function CandidateOfferPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Loading the offer…</p>}>
      <CandidateOffer params={params} />
    </Suspense>
  );
}
