import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { appItemHref, type Surface } from '@/lib/surface';
import { NoProfile } from '../../dashboard/cards';
import { loadOwnProfile } from '../../own-profile';
import { BackLink, Empty } from '../../organization/ui';
import { askHome } from '../actions';
import { loadMyHomes } from '../data';
import { asksHome, fromRefusal, HOME_TYPE_LINES, homeLocationHref, homeTypeOf, officeLockHint, openTypes } from '../home-locations';
import { HomeAskForm } from '../forms';

// Ask for a home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"; everyone may ask, for occasional days at home too): the home's point on a map (or the current location read
// on the device, with its accuracy), a label, the radius shown as 100 m, which HR sets. It goes to HR, then the CEO; a
// C-level person's to the CEO. One being decided at a time: with one, the page says so and links to it. Office staff are
// told the office network's lock still holds at home. The page's heading and body, shown on the site
// (/home-locations/new, from My Requests) and on the phone pages (/app/requests/new/home), where the form, once sent,
// opens the request there. Requested check-in locations (owner, 24 October 2026: "allow the employee to request adding
// this location to his profile, taking the approval cycle for sure, with a reason behind requesting to add this location
// (Home Location - Remote Site - Client Location) with a comment reason"): the request's type, name, radius, reason and
// the end date wished; one being decided at a time of each type; opened from a refused check-in (?from=refusal), the
// point it was refused at filled in.

type Query = Record<string, string | string[] | undefined>;

export function AskHomeHeading({ back }: { back: { href: string; label: string } }) {
  return (
    <div className="space-y-2">
      <BackLink href={back.href}>{back.label}</BackLink>
      <h1 className="page-title">Request a Check-in Location</h1>
    </div>
  );
}

export async function AskHome({ surface = 'site', searchParams }: { surface?: Surface; searchParams?: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams ?? Promise.resolve({} as Query)]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const mine = await loadMyHomes();
  if (mine.kind === 'unavailable') return <Empty>Not available yet.</Empty>;
  const list = mine.kind === 'ok' ? mine.value : [];
  const open = openTypes(list);
  const href = (id: string) => (surface === 'site' ? homeLocationHref(id) : appItemHref(surface, 'home', id));
  const deciding = list.filter((r) => r.status === 'with_hr' || r.status === 'with_ceo');
  if (mine.kind === 'ok' && !asksHome(list)) {
    return (
      <Empty>
        A request of each type is being decided already:{' '}
        {deciding.map((r, i) => (
          <span key={r.id}>
            {i > 0 && ', '}
            <Link href={href(r.id)}>{HOME_TYPE_LINES[homeTypeOf(r)].toLowerCase()}</Link>
          </span>
        ))}
        .
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      {deciding.length > 0 && (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">
          Being decided already:{' '}
          {deciding.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              <Link href={href(r.id)}>{HOME_TYPE_LINES[homeTypeOf(r)].toLowerCase()}</Link>
            </span>
          ))}
          .
        </p>
      )}
      <HomeAskForm action={askHome} lockHint={officeLockHint(profile.employment)} prefill={fromRefusal(query)} open={open} />
    </div>
  );
}
