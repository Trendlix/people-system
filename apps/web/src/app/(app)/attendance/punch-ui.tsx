import { allPressesLabel, flagBadges, placeBadge, pressLabel, pressName, punchMap, type DayEnd, type PlaceBadge, type PunchRow } from './attendance';

// A day's check-in and check-out on the Attendance pages (owner, 20 October 2026, of a row listing a dozen presses:
// "simplify this, i want to view if it is remote or office, and location link"): each its time, its place as a badge
// (Office, Home, Remote, Location unknown) and a small Map link to where it was pressed when the API gives the spot (HR,
// the CEO, the Super Admin, the employee); the flags as compact badges, their full words as the title; and every press
// of the day in a collapsed "All presses (14)", each its time, place and Map. Used by DaysTable (ui.tsx: Daily
// Attendance, a person's month, My Attendance, the team view) and the phone's day list; what each shows is worked out
// in attendance.ts (dayRow), tested. No hooks, nothing server-only.

const TONES: Record<PlaceBadge['tone'], string> = { ok: 'bg-ok-soft text-ok', accent: 'bg-accent-soft text-accent', muted: 'bg-line-soft text-muted' };

export function PlaceBadgeView({ badge }: { badge: PlaceBadge | null }) {
  if (!badge) return null;
  return (
    <span className={`badge ${TONES[badge.tone]}`} title={badge.title ?? undefined}>
      {badge.label}
      {badge.title && <span className="sr-only"> ({badge.title})</span>}
    </span>
  );
}

/** "Map", opening where the press was in a new tab, its accuracy as the title; nothing without its spot. */
export function MapLink({ press }: { press: PunchRow | null }) {
  const map = press ? punchMap(press) : null;
  if (!press || !map) return null;
  return (
    <a href={map.href} target="_blank" rel="noopener noreferrer" title={map.title} className="text-xs font-semibold whitespace-nowrap">
      Map<span className="sr-only"> of {pressName(press)} ({map.title}; opens in a new tab)</span>
    </a>
  );
}

/** The flags as compact badges: a word or two, the full words as the title and for screen readers. */
export function FlagBadges({ flags }: { flags: readonly string[] | null | undefined }) {
  const badges = flagBadges(flags);
  if (!badges.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((f) => (
        <span key={f.key} title={f.title} className="badge bg-warn-soft text-warn">
          <span aria-hidden="true">{f.label}</span>
          <span className="sr-only">{f.title}</span>
        </span>
      ))}
    </span>
  );
}

/** A day's check-in or check-out: its time (or Missing, in amber), its place, Map, and its flags. */
export function DayEndView({ end }: { end: DayEnd }) {
  if (end.shown === 'none') return <span className="text-muted">—</span>;
  return (
    <span className="block space-y-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {end.shown === 'missing' ? <span className="font-medium text-warn">Missing</span> : <span className="tabular-nums whitespace-nowrap">{end.time}</span>}
        <PlaceBadgeView badge={end.badge} />
        <MapLink press={end.press} />
      </span>
      <FlagBadges flags={end.flags} />
    </span>
  );
}

/** Every press of a day, collapsed: "All presses (14)", each its time, place, Map and flags. */
export function AllPresses({ presses, className = 'mt-1' }: { presses: readonly PunchRow[]; className?: string }) {
  return (
    <details className={`${className} text-xs`}>
      <summary className="min-h-6 cursor-pointer font-semibold text-muted">{allPressesLabel(presses.length)}</summary>
      <ol className="mt-1.5 space-y-1.5">
        {presses.map((p, i) => (
          <li key={`${i}-${p.kind}-${p.at}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular-nums whitespace-nowrap">{pressLabel(p)}</span>
            <PlaceBadgeView badge={placeBadge(p.place, p)} />
            <MapLink press={p} />
            <FlagBadges flags={p.flags} />
          </li>
        ))}
      </ol>
    </details>
  );
}
