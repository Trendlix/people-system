import type { Metadata } from 'next';
import Link from 'next/link';
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

const LOCATIONS_INTRO =
  'A check-in on the system within the main office is Office; within a sub-location it is remote, shown with its name; anywhere else remote, at an approved home Home, and without the location, location unknown. Each check-in keeps the spot where it was pressed, read only then: HR, the CEO and the Super Admin see it on a map, and each employee their own.';
const SUBS_INTRO =
  'Places people work from, such as a studio or a client’s site. A check-in within one is remote, shown as “Remote - Studio”. Those linked to it check in there as their own place: not flagged, and while check-ins are locked to the office network, Office staff linked to it may check in there off it. Anyone else is flagged “Not their location” for HR to check.';
const NETWORKS_INTRO =
  'The office’s internet line, by its public address. With the lock on, Office staff can check in and out only from it, or at a sub-location they are linked to: elsewhere the press is refused, with a link to ask for an attendance correction. A check-in on it counts as at the main office whatever the location says. With the GPS lock on too, a press passes when either does, so a rough reading on the office Wi-Fi isn’t refused. No employee’s address is ever kept.';
const ZOHO_INTRO = 'For attendance imported from Zoho People: a check-in at one of these addresses is a day at the office, anywhere else remote.';
const LOCATION_RULE_INTRO =
  'Whether a check-in or check-out on the website needs the location, for everyone. In the app it always does; HR recording a day never does. The GPS lock (below) needs it from Office staff whatever this says.';
const GPS_LOCK_INTRO =
  'Whether Office staff must be at a check-in location to check in and out, read from the location of each press. No server key or fixed address is needed, unlike the office network’s lock; with both on, a press passes when either does. Best in the app, whose location is more precise than a browser’s.';
const CLIENTS_INTRO =
  'Places at a client the CEO approved from an employee’s request: a check-in within one counts for everyone, shown as “Client · name”, and passes the GPS lock. HR changes or ends one here.';

/** What a section says in place of what it couldn't load. */
function notLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not available yet: the server does not have ${what} yet. Please try again after its next update.`;
  if (loaded.kind === 'forbidden') return 'Only HR and Admin keep the check-in setup.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}

const Missing = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">{children}</p>;

async function LocationsSection({ user }: { user: SessionUser }) {
  const [loaded, linkable] = await Promise.all([loadLocations(), loadLinkable()]);
  if (loaded.kind !== 'ok') {
    return (
      <SetupSection id={LOCATIONS_ID} title="Check-in Locations" intro={LOCATIONS_INTRO}>
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
    <SetupSection id={LOCATIONS_ID} title="Check-in Locations" intro={LOCATIONS_INTRO}>
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
              <p className="mt-1 text-sm text-muted">No main office yet: every check-in on the system is kept as location unknown. Add the office: the first location added is the main office.</p>
            </div>
            <AddLocation action={createLocation} around={all} first />
          </div>
        )}

        {(main || subs.length > 0) && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-3xl">
                <h3 className="font-semibold">
                  Sub-Locations{subs.length > 0 && <span className="font-normal text-muted tabular-nums"> · {subs.length}</span>}
                </h3>
                <p className="mt-1 text-sm text-muted">{SUBS_INTRO}</p>
              </div>
            </div>
            {subs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                No sub-locations. Add places people work from, such as a studio or a client&apos;s site.
              </p>
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
                    mainName={main?.name ?? null}
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
            <div className="max-w-3xl">
              <h3 className="font-semibold">
                Client Locations<span className="font-normal text-muted tabular-nums"> · {clients.length}</span>
              </h3>
              <p className="mt-1 text-sm text-muted">{CLIENTS_INTRO}</p>
            </div>
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
        {!removes && <p className="text-xs text-muted">Only a Super Admin removes a location, and the main office only once it is the last; edit one to move it, or make another the main office.</p>}
      </div>
    </SetupSection>
  );
}

async function NetworksSection() {
  const [loaded, h, gps] = await Promise.all([loadNetworks(), headers(), loadGpsLock()]);
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
          <p className="mt-1">{lockText(state, gps.kind === 'ok' && gps.value.inForce)}</p>
        </div>
        <NetworksForm action={saveNetworks} networks={state.networks} lock={state.lock} ready={status.ready} currentIp={currentIp} currentRange={currentNetworkOf(currentIp)} />
      </div>
    </SetupSection>
  );
}

async function LocationRuleSection() {
  const [loaded, networks, gps] = await Promise.all([loadLocationRule(), loadNetworks(), loadGpsLock()]);
  // whether a press from the office network counts without a location: the key in place on both sides, and a network
  const networkReady = networks.kind === 'ok' ? networkStatus(networks.value, webKeySet()).ready && networks.value.networks.length > 0 : null;
  return (
    <SetupSection id={LOCATION_RULE_ID} title="Check-ins Without a Location" intro={LOCATION_RULE_INTRO}>
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the switch')}</Missing>
      ) : (
        <div className="space-y-5">
          <p className={`rounded-lg px-4 py-3 text-sm ${loaded.value.refuseWithoutLocation ? 'bg-ok-soft text-ok' : 'bg-line-soft text-muted'}`} role="status">
            {locationRuleText(loaded.value, networkReady, gps.kind === 'ok' && gps.value.inForce)}
          </p>
          <LocationRuleForm action={saveLocationRule} on={loaded.value.refuseWithoutLocation} />
        </div>
      )}
    </SetupSection>
  );
}

async function GpsLockSection() {
  const [loaded, networks] = await Promise.all([loadGpsLock(), loadNetworks()]);
  const networkInForce = networks.kind === 'ok' && networks.value.inForce;
  return (
    <SetupSection id={GPS_LOCK_ID} title="Check-ins Outside the Check-in Locations" intro={GPS_LOCK_INTRO}>
      {loaded.kind !== 'ok' ? (
        <Missing>{notLoaded(loaded, 'the GPS lock')}</Missing>
      ) : (
        <div className="space-y-5">
          <p
            className={`rounded-lg px-4 py-3 text-sm ${loaded.value.inForce ? 'bg-ok-soft text-ok' : loaded.value.lock ? 'bg-warn-soft text-warn' : 'bg-line-soft text-muted'}`}
            role="status"
          >
            {gpsLockText(loaded.value, networkInForce)}
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
      <p className="max-w-3xl text-sm text-muted">
        Where a check-in counts as Office: the main office and the office&apos;s networks, with the lock that keeps Office staff&apos;s check-ins to the
        office network; the sub-locations people work from, shown as Remote with their name, and the client locations, everyone&apos;s; whether a check-in
        needs the location; the GPS lock that keeps Office staff&apos;s check-ins to the check-in locations (with both locks on, either passing is enough);
        the people exempt from check-in, whose working days count as full hours; the places employees asked to check in from; and Zoho People&apos;s
        addresses for its import. Who can check in from anywhere, or without a location, is set on each person&apos;s <Link href="/employees">profile</Link>,
        with their work arrangement.
      </p>
      <Suspense fallback={<Loading />}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
