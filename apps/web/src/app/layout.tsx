import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Instrument_Sans } from 'next/font/google';
import { FAVICON } from '@/lib/brand';
import './globals.css';

const instrument = Instrument_Sans({
  variable: '--font-instrument',
  subsets: ['latin'],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: '--font-plex-arabic',
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'People System · TrendLIX',
  description: 'TrendLIX Management System',
  // The browser tab icon: the People System's own. The signed-in pages, the sign-in page and the candidate's offer page
  // show the company's thumbnail instead when there is one (brandMetadata, owner's request, 15 October 2026). Kept in
  // public/, not as app/favicon.ico: Next.js puts that one on every page ahead of the thumbnail, and a browser may pick it.
  icons: { icon: FAVICON },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${instrument.variable} ${plexArabic.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
