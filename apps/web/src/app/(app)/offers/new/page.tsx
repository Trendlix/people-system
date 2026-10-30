import Link from 'next/link';
import { Suspense } from 'react';
import { loadLawRates } from '@/lib/law-rates';
import { getCurrentUser } from '@/lib/session';
import { loadPickers } from '../../employees/data';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { loadApplicant } from '../../recruitment/data';
import { applicantHref, offerFromApplication } from '../../recruitment/recruitment';
import { createOffer } from '../actions';
import { loadAllowanceTypes, loadContractSettings, loadEarlierOffers } from '../data';
import { newOfferDefaults } from '../form-body';
import { managesOffers, WHO_CHANGES } from '../list';
import { OfferForm } from '../offer-form';
import { shownCode } from '@/lib/hidden';

// Drafting a job offer for a candidate (owner's request, 15 October 2026). It is saved as a draft: HR checks its PDF on
// the offer's page, then sends it by email or copies the link. From an applicant (recruitment, 22 October 2026: Make
// offer, ?application=), it starts filled in from them and their vacancy, and the applicant moves to Offer once saved.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function NewOffer({ searchParams }: { searchParams: PageProps<'/offers/new'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!managesOffers(user)) return <Empty>{WHO_CHANGES}</Empty>;
  const applicationId = typeof query.application === 'string' && UUID.test(query.application) ? query.application : null;
  const [pickers, allowanceTypes, settings, lawYears, applicant, earlierOffers] = await Promise.all([
    loadPickers(),
    loadAllowanceTypes(),
    loadContractSettings(),
    loadLawRates(),
    applicationId ? loadApplicant(applicationId) : Promise.resolve(null),
    // Recruitment Settings' "Entering earlier offers" (25 October 2026): a past last day is then taken
    loadEarlierOffers(),
  ]);
  const today = todayInCairo();
  const base = newOfferDefaults(settings, today);
  const from = applicant?.kind === 'ok' ? applicant.value : null;
  return (
    <div className="space-y-4">
      {from && (
        <p className="max-w-3xl rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
          From applicant{' '}
          {shownCode(from.number) ? (
            <>
              <Link href={applicantHref(from.id)}>{from.number}</Link>, {from.fullName}
            </>
          ) : (
            <Link href={applicantHref(from.id)}>{from.fullName}</Link>
          )}
          : filled in from them and the vacancy. Type their name in the other
          language, and the terms.
        </p>
      )}
      {applicationId && !from && <p className="max-w-3xl rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">The applicant could not be read: this offer starts empty.</p>}
      <OfferForm
        action={createOffer}
        pickers={{ ...pickers, allowanceTypes }}
        defaults={from ? offerFromApplication(base, from) : base}
        today={today}
        lawYears={lawYears}
        cancelHref={from ? applicantHref(from.id) : '/offers'}
        submitLabel="Save draft"
        applicationId={from?.id}
        earlierOffers={earlierOffers}
      />
    </div>
  );
}

export default function NewOfferPage({ searchParams }: PageProps<'/offers/new'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink href="/offers">Job offers</BackLink>
        <h1 className="page-title">New Job Offer</h1>
        <p className="max-w-3xl text-sm text-muted">
          Saved as a draft: nothing reaches the candidate until you send it from the offer&apos;s page, after checking its PDF.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewOffer searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
