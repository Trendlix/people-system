import Image from 'next/image';
import { getBrand } from '@/lib/api';

/** Logo URL that changes whenever a new logo is uploaded, so browsers don't show an old one. */
export function logoUrl(version: number | string): string {
  return `/company-logo?v=${encodeURIComponent(String(version))}`;
}

function Mark({ name, logoVersion, dark }: { name: string; logoVersion: number | null; dark: boolean }) {
  if (logoVersion !== null) {
    return (
      <span className="relative block size-10 shrink-0 overflow-hidden rounded-lg bg-white">
        <Image src={logoUrl(logoVersion)} alt="" fill unoptimized className="object-contain p-1" />
      </span>
    );
  }
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white ${dark ? 'bg-accent' : 'bg-sidebar'}`}
    >
      {name.trim().charAt(0).toUpperCase() || 'P'}
    </span>
  );
}

/** Company logo and name. `dark` is for the sidebar. */
export async function Brand({ dark = false }: { dark?: boolean }) {
  const brand = await getBrand();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Mark name={brand.nameEn} logoVersion={brand.logoVersion} dark={dark} />
      <div className="min-w-0 leading-tight">
        <p className={`truncate font-semibold ${dark ? 'text-white' : ''}`}>{brand.nameEn}</p>
        <p className={`text-xs ${dark ? 'text-sidebar-text' : 'text-muted'}`}>People System</p>
      </div>
    </div>
  );
}

/** Shown while the company name loads. */
export function BrandFallback({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-10 shrink-0 rounded-lg ${dark ? 'bg-white/10' : 'bg-line'}`} />
      <p className={`text-xs ${dark ? 'text-sidebar-text' : 'text-muted'}`}>People System</p>
    </div>
  );
}
