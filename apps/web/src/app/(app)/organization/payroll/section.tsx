// One section of Payroll Setup (owner's request, 16 October 2026): its heading in Title Case, a short intro saying what
// it changes, and its form or, for those who can't change it, what it is set to. Each section loads and saves on its own.

export function SetupSection({ id, title, intro, children }: { id: string; title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="card scroll-mt-6 p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A section's data that couldn't be read: an API from before it, or a failure, said in its place. */
export function NotLoaded({ what, loaded }: { what: string; loaded: { kind: 'unavailable' } | { kind: 'failed'; message: string } }) {
  return (
    <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">
      {loaded.kind === 'unavailable' ? `Not available yet: the server does not have ${what} yet.` : `${titleFirst(what)} could not be loaded. ${loaded.message}`}
    </p>
  );
}

const titleFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A setting as those who can't change it see it. */
export function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[18rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export const notSet = <span className="text-muted">Not set</span>;
