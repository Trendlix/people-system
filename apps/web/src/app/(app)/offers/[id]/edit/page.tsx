import { Suspense } from 'react';
import { loadLawRates } from '@/lib/law-rates';
import { getCurrentUser } from '@/lib/session';
import { loadPickers } from '../../../employees/data';
import { todayInCairo } from '../../../employees/ui';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { updateOffer, updateSentOffer } from '../../actions';
import { loadAllowanceTypes, loadOffer } from '../../data';
import { offerDefaults } from '../../form-body';
import { canSeeOffers, managesOffers, offerHref, shownStatus, statusLabel, WHO_CHANGES, WHO_SEES } from '../../list';
import { OfferForm, SentOfferForm } from '../../offer-form';

// Changing an offer: a draft, any of it; a sent (or expired) one, only its last day to accept and its note, since the
// candidate has read its terms. Answered and withdrawn offers stay as they are.

async function EditOffer({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canSeeOffers(user)) return <Empty>{WHO_SEES}</Empty>;
  const offer = await loadOffer(params);
  if (!offer) return <Empty>Not available yet: the server does not have job offers yet.</Empty>;
  const back = offerHref(offer.id);
  const heading = (
    <div className="space-y-2">
      <BackLink href={back}>Offer {offer.number}</BackLink>
      <h1 className="text-2xl font-semibold">{offer.status === 'draft' ? 'Edit the Draft' : 'Edit the Offer'}</h1>
      <p className="text-sm text-muted">
        {offer.number} · {offer.fullNameEn}
      </p>
    </div>
  );
  if (!managesOffers(user)) {
    return (
      <>
        {heading}
        <Empty>{WHO_CHANGES}</Empty>
      </>
    );
  }

  const today = todayInCairo();
  const status = shownStatus(offer.status, offer.expiresOn, today);
  let body: React.ReactNode;
  if (status === 'draft') {
    const [pickers, allowanceTypes, lawYears] = await Promise.all([loadPickers(), loadAllowanceTypes(), loadLawRates()]);
    body = (
      <OfferForm
        action={updateOffer.bind(null, offer.id)}
        pickers={{ ...pickers, allowanceTypes }}
        defaults={offerDefaults(offer)}
        today={today}
        lawYears={lawYears}
        cancelHref={back}
        submitLabel="Save draft"
      />
    );
  } else if (status === 'sent' || status === 'expired') {
    body = <SentOfferForm action={updateSentOffer.bind(null, offer.id)} expiresOn={offer.expiresOn} note={offer.note} cancelHref={back} />;
  } else {
    body = <Empty>This offer is {statusLabel(status).toLowerCase()}: it can&apos;t be changed.</Empty>;
  }
  return (
    <>
      {heading}
      {body}
    </>
  );
}

export default function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditOffer params={params} />
      </Suspense>
    </div>
  );
}
