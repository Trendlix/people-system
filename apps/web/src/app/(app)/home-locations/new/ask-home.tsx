import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { appItemHref, type Surface } from '@/lib/surface';
import { NoProfile } from '../../dashboard/cards';
import { loadOwnProfile } from '../../own-profile';
import { BackLink, Empty } from '../../organization/ui';
import { askHome } from '../actions';
import { loadMyHomes } from '../data';
import { asksHome, homeLocationHref, officeLockHint } from '../home-locations';
import { HomeAskForm } from '../forms';

// Ask for a home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"; everyone may ask, for occasional days at home too): the home's point on a map (or the current location read
// on the device, with its accuracy), a label, the radius shown as 100 m, which HR sets. It goes to HR, then the CEO; a
// C-level person's to the CEO. One being decided at a time: with one, the page says so and links to it. Office staff are
// told the office network's lock still holds at home. The page's heading and body, shown on the site
// (/home-locations/new, from My Requests) and on the phone pages (/app/requests/new/home), where the form, once sent,
// opens the request there.

export function AskHomeHeading({ back }: { back: { href: string; label: string } }) {
  return (
    <div className="space-y-2">
      <BackLink href={back.href}>{back.label}</BackLink>
      <h1 className="text-2xl font-semibold">Ask for a Home Location</h1>
      <p className="text-muted">
        For the days you work from home, often or now and then. HR approves it, then the CEO; once approved, a check-in at home shows as Home, and
        one elsewhere outside the office is flagged for HR.
      </p>
    </div>
  );
}

export async function AskHome({ surface = 'site' }: { surface?: Surface }) {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const mine = await loadMyHomes();
  if (mine.kind === 'unavailable') return <Empty>Not available yet: the server does not have home locations yet.</Empty>;
  if (mine.kind === 'ok' && !asksHome(mine.value)) {
    const open = mine.value.find((r) => r.status === 'with_hr' || r.status === 'with_ceo')!;
    return (
      <Empty>
        Your home location request is being decided already.{' '}
        <Link href={surface === 'site' ? homeLocationHref(open.id) : appItemHref(surface, 'home', open.id)}>Open it</Link> to follow it, or withdraw it to
        ask again with another point.
      </Empty>
    );
  }
  return <HomeAskForm action={askHome} lockHint={officeLockHint(profile.employment)} />;
}
