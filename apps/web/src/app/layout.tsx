import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Instrument_Sans } from 'next/font/google';
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
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${instrument.variable} ${plexArabic.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
