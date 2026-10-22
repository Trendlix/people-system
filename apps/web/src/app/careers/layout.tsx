import type { Metadata } from 'next';
import { brandMetadata } from '@/components/brand';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"): a plain public page, no sidebar and no
// sign-in, at people.trendlix.com/careers (careers.trendlix.com can point at it later: lib/public-paths.ts). Open to
// search engines, as a job advert is. The browser tab icon is the company's thumbnail when there is one.

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Careers', ...(await brandMetadata()) };
}

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}
