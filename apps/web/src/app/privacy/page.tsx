import type { Metadata } from 'next';

// The employee app's privacy policy (owner, 6 November 2026: "now i have google play console"): Google Play asks every
// app for a public privacy policy, and for one that reads the location in the background, what it reads, why, who sees
// it and how long it is kept. It says what Trendlix People (the app and this website) actually keeps: the employee's
// work records, the location at check-in and, when the company switches it on, while checked in (every hour on Android;
// on iPhones and iPads when the phone leaves the check-in area, from the first App Store update after approval: owner,
// 7 November 2026), photos and files people add, and the device's name; never sold, no ads, no tracking across other
// apps. Public (lib/public-paths.ts), and static: built once, with the company's name and contact address below.

export const metadata: Metadata = { title: 'Privacy Policy · Trendlix People' };

/** The company the system is for. */
const company = 'Trendlix';
/** Where privacy questions go. */
const CONTACT = 'hr@trendlix.com';
/** When this policy last changed (DD/MM/YYYY). */
const UPDATED = '07/11/2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="card space-y-6 p-6 text-sm leading-relaxed sm:p-8">
        <div className="space-y-1">
          <h1 className="page-title">Privacy Policy</h1>
          <p className="text-muted">Trendlix People, the employee app and website of {company} · Last updated {UPDATED}</p>
        </div>

        <p>
          Trendlix People is {company}’s system for its employees’ work records: attendance, leave and other requests, timesheets, pay and
          documents. It is for {company}’s employees only and is used with a work account. This policy says what it collects, why, who sees it and
          how long it is kept.
        </p>

        <Section title="What it collects">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Your work records:</strong> your name, work email, job, department and manager; your attendance (check-ins and check-outs),
              leave and other requests, timesheets, performance scores, pay and payslips, as your employment needs them.
            </li>
            <li>
              <strong>Your location when you check in or out:</strong> to confirm you’re at a place you may check in from.
            </li>
            <li>
              <strong>Your location while you’re checked in, in the background:</strong> only when {company} switches this on. Trendlix People
              then collects location data to confirm you’re at the place you checked in, even when the app is closed or not in use. On Android,
              it is read every hour. On iPhone and iPad, it is read only when your phone leaves an area of about 300 m around where you checked
              in, or moves about 500 m. It stops when you check out or sign out. The app explains this and asks for your permission first
              (“Allow all the time” on Android, “Always” on iPhone and iPad); without it, nothing is read in the background, and HR sees that
              it isn’t allowed.
            </li>
            <li>
              <strong>Photos and files you add:</strong> for example your profile photo, a document for a leave request or a receipt for an
              expense claim.
            </li>
            <li>
              <strong>Your device:</strong> its name and model, to show where you’re signed in and to keep your account safe. Fingerprint or face
              sign-in is checked by your phone; the app never receives your fingerprint or face.
            </li>
          </ul>
        </Section>

        <Section title="How it is used">
          <p>
            Only to run your employment with {company}: recording attendance, deciding requests, paying salaries, and keeping the records the
            law requires. It is never sold, never used for advertising, and never used to track you across other apps or websites.
          </p>
        </Section>

        <Section title="Who sees it">
          <p>
            {company}’s HR team and, for what their role needs, your managers and the company’s management. Sensitive details (your national ID,
            bank details and pay) are restricted further, and every look at them is recorded. The services that run the system for {company}
            (its servers, and email and messaging delivery) process the data only to provide them. It is shared with authorities only when the
            law requires it, for example for social insurance and tax.
          </p>
        </Section>

        <Section title="How it is kept safe">
          <p>
            Everything is sent encrypted. You sign in with your work account, and the app keeps your sign-in in your phone’s secure storage. Who
            can see what is set by role, and changes are recorded in an audit log.
          </p>
        </Section>

        <Section title="How long it is kept">
          <p>
            For as long as you work with {company}, and afterwards for as long as Egyptian law requires employment, pay and tax records to be
            kept. Location readings are kept with your attendance records.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You can refuse the location permission or turn it off in your phone’s settings at any time; checking in then needs it again. You can
            ask {company}’s HR team to see or correct your information, or ask any question about this policy, at{' '}
            <a href={`mailto:${CONTACT}`} className="font-medium">
              {CONTACT}
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}
