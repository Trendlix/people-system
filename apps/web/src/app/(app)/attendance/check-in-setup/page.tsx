import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { currentNetworkOf, normalizedIp } from '@trendlix/shared';
import { clientIp } from '@/lib/client-ip';
import { getCurrentUser } from '@/lib/session';
import { webKeySet } from '@/lib/signed-ip';
import type { SessionUser } from '@/lib/types';
import { Empty, Loading } from '../../organization/ui';
import { SetupSection } from '../../organization/payroll/section';
import type { Loaded } from '../../payroll/load';
import { StaffOnly } from '../../staff-only';
import { createLocation, removeLocation, saveNetworks, saveZohoAddresses, updateLocation } from './actions';
import { loadLocations, loadNetworks, loadSettings } from './data';
import { LocationCard } from './location-card';
import { LocationForm } from './location-form';
import { NetworksForm } from './networks-form';
import { LOCATIONS_ID, lockText, networkStatus, NETWORKS_ID, removesLocations, seesCheckInSetup, ZOHO_ID } from './setup';
import { ZohoAddressesForm } from './zoho-form';

// Attendance → Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations"; asked whether check-in locations should get their own page with several locations: "Own page, several
// locations"). Where a check-in counts as the office, in three sections, each loading and saving on its own: Check-in
// Locations (a name, a point and a radius each; within any of them a check-in on the system is at the office); Office
// Networks, the office's public addresses with the switch locking check-ins to them (owner, the same day: "allow me to
// lock checkin's to wifi name or ip, whatever is right"), and whether the key the website signs the visitor's address
// with is in place on both sides; and Zoho People's check-in addresses, for its import (moved here from Payroll Setup →
// Your Rules). HR and Admin (a Super Admin as an Admin); a Super Admin removes a location. The API checks every request.

export const metadata: Metadata = { title: 'Check-in Setup · People System' };

const LOCATIONS_INTRO =
  'A check-in on the system within the radius of any of these is at the office; outside them all it is remote, and without the location it is location unknown. Only that and the location’s name are kept, never the coordinates.';
const NETWORKS_INTRO =
  'The office’s internet line, by its public address. With the lock on, Office staff can check in and out only from it: off it the press is refused, with a link to ask for an attendance correction. A check-in on it counts as at the office whatever the location says. No employee’s address is ever kept.';
const ZOHO_INTRO = 'For attendance imported from Zoho People: a check-in at one of these addresses is a day at the office, anywhere else remote.';

/** What a section says in place of what it couldn't load. */
function notLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not available yet: the server does not have ${what} yet. Please try again after its next update.`;
  if (loaded.kind === 'forbidden') return 'Only HR and Admin keep the check-in setup.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}

const Missing = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">{children}</p>;

async function LocationsSection({ user }: { user: SessionUser }) {
  const loaded = await loadLocations();
  const removes = removesLocations(user);
  return (
    <SetupSection id={LOCATIONS_ID} title="Check-in Locations" intro={LOCATIONS_INTRO}>
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the check-in locations')}</Missing>
      ) : (
        <div className="space-y-6">
          {loaded.value.length === 0 ? (
            <p className="text-sm text-muted">No check-in location yet: every check-in on the system is kept as location unknown. Add the office below.</p>
          ) : (
            <ul className="space-y-3">
              {loaded.value.map((l) => (
                <LocationCard key={l.id} location={l} update={updateLocation.bind(null, l.id)} remove={removes ? removeLocation.bind(null, l.id) : null} />
              ))}
            </ul>
          )}
          <div className="border-t border-line-soft pt-5">
            <h3 className="mb-3 font-semibold">Add a Location</h3>
            <LocationForm action={createLocation} submitLabel="Add location" />
          </div>
          {!removes && <p className="text-xs text-muted">Only a Super Admin removes a location; edit one to move it.</p>}
        </div>
      )}
    </SetupSection>
  );
}

async function NetworksSection() {
  const [loaded, h] = await Promise.all([loadNetworks(), headers()]);
  if (loaded.kind !== 'ok') {
    return (
      <SetupSection id={NETWORKS_ID} title="Office Networks" intro={NETWORKS_INTRO}>
        <Missing>{notLoaded(loaded, 'the office networks')}</Missing>
      </SetupSection>
    );
  }
  const state = loaded.value;
  const status = networkStatus(state, webKeySet());
  // this page's address: as the API trusted it, else as this website sees it (before the key is in place)
  const currentIp = state.here.signed ? state.here.ip : normalizedIp(clientIp(h));
  return (
    <SetupSection id={NETWORKS_ID} title="Office Networks" intro={NETWORKS_INTRO}>
      <div className="space-y-5">
        <div className={`rounded-lg px-4 py-3 text-sm ${status.ready ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`} role="status">
          <p>{status.text}</p>
          <p className="mt-1">{lockText(state)}</p>
        </div>
        <NetworksForm action={saveNetworks} networks={state.networks} lock={state.lock} ready={status.ready} currentIp={currentIp} currentRange={currentNetworkOf(currentIp)} />
      </div>
    </SetupSection>
  );
}

async function ZohoSection() {
  const loaded = await loadSettings();
  return (
    <SetupSection id={ZOHO_ID} title="Zoho People's Check-in Addresses" intro={ZOHO_INTRO}>
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the addresses')}</Missing>
      ) : loaded.value.officeAddresses === undefined ? (
        <Missing>Not available yet: the server does not have the addresses yet.</Missing>
      ) : (
        <ZohoAddressesForm action={saveZohoAddresses} addresses={loaded.value.officeAddresses} />
      )}
    </SetupSection>
  );
}

async function Gate() {
  const user = await getCurrentUser();
  if (!seesCheckInSetup(user)) return <Empty>Only HR and Admin keep the check-in setup.</Empty>;
  return (
    <>
      <Suspense fallback={<Loading />}>
        <LocationsSection user={user} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <NetworksSection />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ZohoSection />
      </Suspense>
    </>
  );
}

export default function CheckInSetupPage() {
  return (
    <StaffOnly>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Check-in Setup</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Where a check-in counts as at the office: the check-in locations and the office&apos;s networks, with the lock that keeps Office staff&apos;s
            check-ins to the office network, and Zoho People&apos;s addresses for its import. Who can check in from anywhere is set on each
            person&apos;s <Link href="/employees">profile</Link>, with their work arrangement.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Gate />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
