import type { Metadata } from 'next';
import { Bebas_Neue, Cairo, Inter_Tight, Urbanist } from 'next/font/google';
import { Suspense } from 'react';
import { brandMetadata } from '@/components/brand';
import { CareersFooter, CareersHeader, CareersHeaderFallback, ContactBand } from './site-chrome';
import './careers.css';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"): a public page, no sidebar and no sign-in,
// at people.trendlix.com/careers (careers.trendlix.com can point at it later: lib/public-paths.ts). Open to search
// engines, as a job advert is. The browser tab icon is the company's thumbnail when there is one.
// Dressed as trendlix.com (owner, 22 October 2026: "i will put it in the main website, i need it to match the UI"; then
// its new design, "just take the design framework and guidelines"): its fonts (Bebas Neue for headings, Urbanist in
// forms, Cairo for Arabic; Inter Tight standing in for its paid Roc Grotesk, the copy), its dark theme (careers.css),
// its header and menu, its Get in touch band and footer. Framed only by trendlix.com (next.config.ts).
// Each page leaves room under the fixed header itself (ui.tsx PageFrame), as the careers page's hero goes under it.

const display = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-careers-display' });
const copy = Inter_Tight({ subsets: ['latin'], variable: '--font-careers-copy' });
const field = Urbanist({ subsets: ['latin'], variable: '--font-careers-field' });
const arabic = Cairo({ subsets: ['arabic'], variable: '--font-careers-arabic' });

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Careers', ...(await brandMetadata()) };
}

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`careers-site ${display.variable} ${copy.variable} ${field.variable} ${arabic.variable}`}>
      <Suspense fallback={<CareersHeaderFallback />}>
        <CareersHeader />
      </Suspense>
      <main id="careers-main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <ContactBand />
      <Suspense fallback={null}>
        <CareersFooter />
      </Suspense>
    </div>
  );
}
