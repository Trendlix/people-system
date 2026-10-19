import type { Loaded } from '../payroll/load';

// What an Attendance page says in place of what it couldn't load (owner, 19 October 2026: the Attendance section). Pure,
// tested; relative imports, as vitest doesn't know the "@/" paths.

export function notLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return 'Not available yet: the server does not have this yet. Please try again after its next update.';
  if (loaded.kind === 'forbidden') return "Only HR, Finance and the CEO see everyone's attendance; a manager sees their team's on My Team.";
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
