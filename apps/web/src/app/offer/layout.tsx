import type { Metadata } from 'next';

// The candidate's side of a job offer (owner's request, 15 October 2026): a plain page, no sidebar and no sign-in, opened
// from the link HR sends. Kept out of search engines, and the link (its token is the key) is never passed on to other
// sites as a referrer.

export const metadata: Metadata = {
  title: 'Job Offer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function OfferLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}
