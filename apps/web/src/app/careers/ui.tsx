import Image from 'next/image';
import Link from 'next/link';
import { brandMark } from '@/lib/brand';
import type { CompanyBrand } from '@/lib/types';
import { CAREERS_PATH } from './careers';

// The careers page's pieces (owner, 22 October 2026: "where will we include the ATS?"): the company's header, linking to
// the open jobs, and a short notice in place of a page that can't be shown.

export type CareersBrand = Pick<CompanyBrand, 'logoVersion' | 'thumbnailVersion'> & { nameEn: string; nameAr: string | null };

export function CompanyHeader({ brand }: { brand: CareersBrand }) {
  const mark = brandMark(brand).full;
  return (
    <header className="mb-6 sm:mb-8">
      <Link href={CAREERS_PATH} className="flex items-center gap-3 text-ink no-underline hover:text-ink">
        {mark ? (
          <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg border border-line bg-white">
            <Image src={mark} alt="" fill unoptimized className="object-contain p-1" />
          </span>
        ) : (
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sidebar text-xl font-bold text-white">
            {brand.nameEn.trim().charAt(0).toUpperCase() || '·'}
          </span>
        )}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-lg font-semibold">{brand.nameEn}</span>
          <span className="block text-sm text-muted">Careers</span>
        </span>
      </Link>
    </header>
  );
}

export function Notice({ brand, title, children }: { brand: CareersBrand | null; title: string; children: React.ReactNode }) {
  return (
    <>
      {brand && <CompanyHeader brand={brand} />}
      <section className="card space-y-3 p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="space-y-3 text-sm leading-relaxed">{children}</div>
      </section>
    </>
  );
}
