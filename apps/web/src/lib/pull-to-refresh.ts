// Pull to refresh on the phone pages (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 5: "a light
// custom pull-down gesture at the top of the page that calls router.refresh(), with a spinner. Touch only … it must not
// fight the page's scrolling, the maps or the inputs"): how far a finger's pull moves the circle, when a touch becomes
// a pull, and when letting go refreshes. app/(phone)/app/pull-to-refresh.tsx follows the finger. Pure code, tested.

/** How far (px) the finger moves before the touch is a pull or not: a tap, a scroll or a swipe stays theirs. */
export const PULL_SLOP = 10;

/** How far (px) the circle comes down for letting go to refresh. */
export const PULL_TRIGGER = 64;

/** The furthest (px) the circle comes down, however far the finger goes. */
export const PULL_MAX = 112;

/** How long (ms) the spinner turns at least, so a quick refresh still shows it was done. */
export const REFRESH_MIN_MS = 500;

/** What a touch is so far: not decided, a pull of ours, or not ours (a scroll up, a swipe sideways). */
export type TouchKind = 'undecided' | 'pull' | 'not-ours';

/**
 * What a touch that began at the top of the page is, once the finger moved `dx`, `dy` px (down is positive): a pull
 * once it went down past the slop, clearly more down than sideways; not ours once it went up, or sideways first.
 */
export function touchKind(dx: number, dy: number): TouchKind {
  if (dy < -PULL_SLOP / 2) return 'not-ours';
  if (Math.abs(dx) > PULL_SLOP && Math.abs(dx) >= dy) return 'not-ours';
  if (dy > PULL_SLOP && dy > Math.abs(dx) * 1.5) return 'pull';
  return 'undecided';
}

/**
 * How far the circle comes down for a pull of `dy` px: a little more than half the finger's way (so about 125 px of
 * finger reach PULL_TRIGGER), then harder past it, never past PULL_MAX.
 */
export function pullDistance(dy: number): number {
  const pulled = Math.max(0, dy - PULL_SLOP) * 0.55;
  const eased = pulled <= PULL_TRIGGER ? pulled : PULL_TRIGGER + (pulled - PULL_TRIGGER) * 0.4;
  return Math.round(Math.min(PULL_MAX, eased) * 10) / 10;
}

/** Whether letting go now refreshes the page. */
export const refreshes = (distance: number): boolean => distance >= PULL_TRIGGER;
