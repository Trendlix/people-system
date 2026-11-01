import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { currentNetworkOf, normalizedIp } from '@trendlix/shared';
import { clientIp } from '@/lib/client-ip';
import { titleCase } from '@/lib/format';
import type { MapCircle } from '@/lib/map-point';
import { getCurrentUser } from '@/lib/session';
import { webKeySet } from '@/lib/signed-ip';
import type { SessionUser } from '@/lib/types';
import { Empty, Loading } from '../ui';
import { SetupSection } from '../payroll/section';
import type { Loaded } from '../../payroll/load';
import { seesHomes } from '../../home-locations/home-locations';
import {
  createLocation,
  endClientLocation,
  linkPeople,
  makeMain,
  removeLocation,
  saveClientEnd,
  saveGpsLock,
  saveLocationRule,
  saveNetworks,
  saveZohoAddresses,
  unlinkPerson,
  updateLocation,
} from './actions';
import { AddLocation } from './add-location';
import { ClientLocationCard } from './client-location-card';
import { loadGpsLock, loadLinkable, loadLocationRule, loadLocations, loadNetworks, loadSettings } from './data';
import { ExemptionsSection } from './exemptions-section';
import { GpsLockForm } from './gps-lock-form';
import { HomeLocationsSection } from './home-locations-section';
import { MainOfficeCard, SubLocationCard } from './location-card';
import { MapsSection } from './maps-section';
import { seesMapsSettings } from './maps-setup';
import { LocationRuleForm } from './location-rule-form';
import { NetworksForm } from './networks-form';
import {
  clientLocationsOf,
  CLIENTS_ID,
  faintCircles,
  GPS_LOCK_ID,
  gpsLockText,
  LOCATION_RULE_ID,
  locationRuleText,
  LOCATIONS_ID,
  lockText,
  mainAndSubs,
  networkStatus,
  NETWORKS_ID,
  removesLocations,
  seesCheckInSetup,
  ZOHO_ID,
} from './setup';
import { ZohoAddressesForm } from './zoho-form';

// Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations"; asked whether check-in locations should get their own page with several locations: "Own page, several
// locations"). Where a check-in counts as the office, in three sections, each loading and saving on its own: Check-in
// Locations (a name, a point and a radius each; within any of them a check-in on the system is at the office); Office
// Networks, the office's public addresses with the switch locking check-ins to them (owner, the same day: "allow me to
// lock checkin's to wifi name or ip, whatever is right"), and whether the key the website signs the visitor's address
// with is in place on both sides; and Zoho People's check-in addresses, for its import (moved here from Payroll Setup →
// Your Rules). HR and Admin (a Super Admin as an Admin); a Super Admin removes a location. The API checks every request.
// The locations on a map (owner, the same day: "let me view location on map and add location from map"): one map of
// them all above the list, named in tooltips, a map on each card, and a map in each form to put the point on. Home
// Locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from home"):
// the approved homes, each with a small map and Remove, for HR and the Super Admin (never an Admin without them). The
// spot kept with each press (owner, 20 October 2026: "Yes, keep the spot"), and Check-ins Without a Location, the switch
// refusing presses without one (the same day: "Company switch + exceptions", "Allow as Office"). The main office and its
// sub-locations (owner, 20 October 2026: "for this part, it looks unarranged to me, it needs to be more handsome. main
// office location is the hero and other locations are like sub locations. shown with their name and linked users"; "any
// checkin rather than the office location counts remote and named with the location name (Remote - Location name)"):
// the main office as the hero, its large map with the sub-locations drawn faintly (the overview map it replaces), then
// the sub-locations' cards in a grid, each with its people and Link people, and "Add a sub-location" opening the form.
// The GPS lock (owner, 24 October 2026: "while these aare not checked, people can still check in and out from anywhere";
// asked, "Yes, add a GPS lock too"): Check-ins Outside the Check-in Locations, its switch and the "too rough" limit, beside
// the switch refusing presses without a location. The client locations (the same day: "all employees if a customer
// location"), approved from employees' requests, everyone's, in their own group under the sub-locations, each changed or
// ended here; and HR's list of the requested check-in locations of all three types (Home Location, Remote Site, Client
// Location), filtered by type and status through the page's address, in place of the approved homes' list. People exempt
// from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance checkins and
// outs, trat them as if they achived their full working hours"; asked, "Profile + a list in Check-in Setup"): Exempt From
// Check-in, after the locks, with "Add people" and "End now".

export const metadata: Metadata = { title: 'Check-in Setup · People System' };

/** What a section says in place of what it couldn't load. */
function notLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not available yet: the server does not have ${what} yet.`;
  if (loaded.kind === 'forbidden') return 'Only HR and Admin keep the check-in setup.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}

const Missing = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">{children}</p>;

async function LocationsSection({ user }: { user: SessionUser }) {
  const [loaded, linkable] = await Promise.all([loadLocations(), loadLinkable()]);
  if (loaded.kind !== 'ok') {
    return (
      <SetupSection id={LOCATIONS_ID} title="Check-in Locations">
        <Missing>{notLoaded(loaded, 'the check-in locations')}</Missing>
      </SetupSection>
    );
  }
  const removes = removesLocations(user);
  const { main, subs } = mainAndSubs(loaded.value);
  // the client locations (24 October 2026: "all employees if a customer location"), apart from the office's
  const clients = clientLocationsOf(loaded.value);
  const circle = (l: (typeof loaded.value)[number]): MapCircle => ({ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres, name: titleCase(l.name) });
  const all = loaded.value.map(circle);
  const othersOf = (id: string) => loaded.value.filter((l) => l.id !== id).map(circle);
  // whom Link people offers; an API from before sub-locations has no such list, and no linking
  const candidates = linkable.kind === 'ok' ? linkable.value : null;
  return (
    <SetupSection id={LOCATIONS_ID} title="Check-in Locations">
      <div className="space-y-8">
        {main ? (
          <MainOfficeCard
            location={main}
            around={faintCircles([...subs, ...clients.filter((c) => !c.endedAt)])}
            others={othersOf(main.id)}
            update={updateLocation.bind(null, main.id)}
            remove={removes && subs.length === 0 ? removeLocation.bind(null, main.id) : null}
          />
        ) : (
          <div className="space-y-4 rounded-xl border border-dashed border-line bg-canvas p-6">
            <div>
              <h3 className="font-semibold">Main Office</h3>
              <p className="mt-1 text-sm text-muted">No main office yet.</p>
            </div>
            <AddLocation action={createLocation} around={all} first />
          </div>
        )}

        {(main || subs.length > 0) && (
          <div className="space-y-4">
            <h3 className="font-semibold">
              Sub-Locations{subs.length > 0 && <span className="font-normal text-muted tabular-nums"> · {subs.length}</span>}
            </h3>
            {subs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No sub-locations.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {subs.map((l) => (
                  <SubLocationCard
                    key={l.id}
                    location={l}
                    others={othersOf(l.id)}
                    candidates={candidates}
                    update={updateLocation.bind(null, l.id)}
                    link={linkPeople.bind(null, l.id)}
                    unlink={unlinkPerson.bind(null, l.id)}
                    makeMain={makeMain.bind(null, l.id, l.name)}
                    remove={removes ? removeLocation.bind(null, l.id) : null}
                  />
                ))}
              </ul>
            )}
            {main && <AddLocation action={createLocation} around={all} first={false} />}
          </div>
        )}

        {clients.length > 0 && (
          <div id={CLIENTS_ID} className="scroll-mt-6 space-y-4">
            <h3 className="font-semibold">
              Client Locations<span className="font-normal text-muted tabular-nums"> · {clients.length}</span>
            </h3>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {clients.map((l) => (
                <ClientLocationCard
                  key={l.id}
                  location={l}
                  others={othersOf(l.id)}
                  update={updateLocation.bind(null, l.id)}
                  saveEnd={saveClientEnd.bind(null, l.id)}
                  end={endClientLocation.bind(null, l.id, l.name)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </SetupSection>
  );
}

async function NetworksSection() {
  const [loaded, h] = await Promise.all([loadNetworks(), headers()]);
  if (loaded.kind !== 'ok') {
    return (
      <SetupSection id={NETWORKS_ID} title="Office Networks">
        <Missing>{notLoaded(loaded, 'the office networks')}</Missing>
      </SetupSection>
    );
  }
  const state = loaded.value;
  const status = networkStatus(state, webKeySet());
  // this page's address: as the API trusted it, else as this website sees it (before the key is in place)
  const currentIp = state.here.signed ? state.here.ip : normalizedIp(clientIp(h));
  return (
    <SetupSection id={NETWORKS_ID} title="Office Networks">
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

async function LocationRuleSection() {
  const loaded = await loadLocationRule();
  return (
    <SetupSection id={LOCATION_RULE_ID} title="Check-ins Without a Location">
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the switch')}</Missing>
      ) : (
        <div className="space-y-5">
          <p className={`rounded-lg px-4 py-3 text-sm ${loaded.value.refuseWithoutLocation ? 'bg-ok-soft text-ok' : 'bg-line-soft text-muted'}`} role="status">
            {locationRuleText(loaded.value)}
          </p>
          <LocationRuleForm action={saveLocationRule} on={loaded.value.refuseWithoutLocation} />
        </div>
      )}
    </SetupSection>
  );
}

async function GpsLockSection() {
  const loaded = await loadGpsLock();
  return (
    <SetupSection id={GPS_LOCK_ID} title="Check-ins Outside the Check-in Locations">
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the GPS lock')}</Missing>
      ) : (
        <div className="space-y-5">
          <p
            className={`rounded-lg px-4 py-3 text-sm ${loaded.value.inForce ? 'bg-ok-soft text-ok' : loaded.value.lock ? 'bg-warn-soft text-warn' : 'bg-line-soft text-muted'}`}
            role="status"
          >
            {gpsLockText(loaded.value)}
          </p>
          <GpsLockForm action={saveGpsLock} on={loaded.value.lock} roughMetres={loaded.value.roughMetres} />
        </div>
      )}
    </SetupSection>
  );
}

async function ZohoSection() {
  const loaded = await loadSettings();
  return (
    <SetupSection id={ZOHO_ID} title="Zoho People's Check-in Addresses">
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

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/check-in-setup'>['searchParams'] }) {
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
        <LocationRuleSection />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <GpsLockSection />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ExemptionsSection />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ZohoSection />
      </Suspense>
      {seesHomes(user) && (
        <Suspense fallback={<Loading />}>
          <HomeLocationsSection searchParams={searchParams} />
        </Suspense>
      )}
      {/* Google Maps for every map (owner, 24 October 2026: "Google Maps"): the key, a Super Admin's */}
      {seesMapsSettings(user) && (
        <Suspense fallback={<Loading />}>
          <MapsSection user={user} />
        </Suspense>
      )}
    </>
  );
}

// Under Organization since 23 October 2026 (owner: "Check-in Setup, KPI Pillars and deadlines, Recruitment and
// checklists, Templates"), in the setup menu's Time & Leave, which gives the heading and keeps it from an employee.
export default function CheckInSetupPage({ searchParams }: PageProps<'/organization/check-in-setup'>) {
  return (
    <div className="max-w-5xl space-y-6">
      <Suspense fallback={<Loading />}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
