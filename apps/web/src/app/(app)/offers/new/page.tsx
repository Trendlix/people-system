import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { loadPickers } from '../../employees/data';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { createOffer } from '../actions';
import { loadAllowanceTypes, loadContractSettings } from '../data';
import { newOfferDefaults } from '../form-body';
import { managesOffers, WHO_CHANGES } from '../list';
import { OfferForm } from '../offer-form';

// Drafting a job offer for a candidate (owner's request, 15 October 2026). It is saved as a draft: HR checks its PDF on
// the offer's page, then sends it by email or copies the link.

async function NewOffer() {
  const user = await getCurrentUser();
  if (!managesOffers(user)) return <Empty>{WHO_CHANGES}</Empty>;
  const [pickers, allowanceTypes, settings] = await Promise.all([loadPickers(), loadAllowanceTypes(), loadContractSettings()]);
  const today = todayInCairo();
  return (
    <OfferForm
      action={createOffer}
      pickers={{ ...pickers, allowanceTypes }}
      defaults={newOfferDefaults(settings, today)}
      today={today}
      cancelHref="/offers"
      submitLabel="Save draft"
    />
  );
}

export default function NewOfferPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink href="/offers">Job offers</BackLink>
        <h1 className="text-2xl font-semibold">New Job Offer</h1>
        <p className="max-w-3xl text-sm text-muted">
          Saved as a draft: nothing reaches the candidate until you send it from the offer&apos;s page, after checking its PDF.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewOffer />
      </Suspense>
    </div>
  );
}
