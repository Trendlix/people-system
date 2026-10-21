import Link from 'next/link';
import { assetsCan, type AssetsAccessView } from '@trendlix/shared';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { PhoneCard } from './ui';

// Assets on the phone's Home (owner's brief, 21 October 2026: "an 'Assets' entry for people with access … Keep it
// light"): for those with Assets access, a search of the register and the way to it, and Add asset for a custodian or a
// manager (the camera first). Nothing for anyone else. A card rather than a tab: the tab bar stays as it is for everyone
// (Home, Requests, Attendance, Payslips, To Approve).

export function AssetsCard({ assets }: { assets: AssetsAccessView | null | undefined }) {
  const can = assetsCan(assets ?? { access: 'none', values: false, ai: false });
  if (!can.view) return null;
  return (
    <PhoneCard
      title="Assets"
      action={
        <Link href={APP_ASSET_PATHS.list} className="text-sm">
          All assets
        </Link>
      }
    >
      <form action={APP_ASSET_PATHS.list} role="search" className="flex gap-2">
        <label htmlFor="home-asset-search" className="sr-only">
          Find an asset
        </label>
        <input id="home-asset-search" name="q" type="search" maxLength={100} placeholder="Name, code, serial or holder" className="input min-h-12 flex-1" />
        <button type="submit" className="btn btn-secondary min-h-12">
          Find
        </button>
      </form>
      {can.register && (
        <Link href={APP_ASSET_PATHS.new} className="btn btn-primary mt-3 min-h-12 w-full">
          Add asset
        </Link>
      )}
    </PhoneCard>
  );
}
