import Link from 'next/link';
import { APP_CUSTODY_PATHS } from '@/lib/asset-paths';
import { itemsText } from '../../(app)/assets/custody';
import { loadMyCustody } from '../../(app)/assets/custody-data';
import { PhoneCard } from './ui';

// My Custody on the phone's Home (owner, 21 October 2026: "Yes, My custody"; the brief: "a card or tab on the phone
// pages"): only while the person holds something of the company's assets, how many items and how many are overdue, and
// the way to My Custody. Nothing for anyone else (nor from an API from before custody).

export async function MyCustodyCard() {
  const loaded = await loadMyCustody();
  if (loaded.kind !== 'ok' || !loaded.value.current.length) return null;
  const { current, overdue } = loaded.value;
  return (
    <PhoneCard
      title="My Custody"
      action={
        <Link href={APP_CUSTODY_PATHS.mine} className="text-sm">
          See all
        </Link>
      }
    >
      <p className="text-sm">
        You hold {itemsText(current.length)} of the company&apos;s assets.
        {overdue > 0 && <span className="badge ml-2 bg-danger-soft text-danger">{overdue} overdue</span>}
      </p>
    </PhoneCard>
  );
}
