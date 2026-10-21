import { KPI_LEVEL_LABELS, KPI_LEVEL_RANGES, kpiMonthName, kpiPercentText, type KpiHeatmap, type KpiLevel } from '@trendlix/shared';
import { KPI_PATHS } from '../../../lib/kpi-paths';
import { LEVEL_BADGE, LEVELS_DOWN, statusText } from './scorecard';

// The KPI heatmap and the level distribution (owner's brief, 21 October 2026: "a team overview heatmap (people × months,
// final % coloured by level) with the level distribution"; the prototype's "Score history by employee"): what each cell
// says and how it is coloured, each person's change from one scored month to the next, and the levels counted with
// their share. Pure code, tested; relative imports, as vitest doesn't know the "@/" paths.

type Cell = KpiHeatmap['rows'][number]['cells'][number];

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026" for "2026-10": the heatmap's column. */
export const monthShort = (month: string) => `${SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** A cell as the heatmap shows it: its text, its colours, where it opens, and what a screen reader hears. */
export interface HeatCell {
  href: string | null;
  text: string;
  className: string;
  label: string;
}

/** Still being scored (or not shown to the caller yet): the step it is at, in a word. */
const PENDING: Record<string, string> = {
  self_rating: 'Self',
  manager: 'Scoring',
  hr: 'HR',
  sign_off: 'Sign',
  final: '—',
};

/**
 * A person's month: its final % coloured by its level, opening its scorecard; one not scored yet, the step it is at, in
 * grey; no scorecard that month, an empty cell.
 */
export function heatCell(cell: Cell, month: string, name: string): HeatCell {
  const when = `${name}, ${kpiMonthName(month)}`;
  if (!cell) return { href: null, text: '', className: 'bg-canvas', label: `${when}: no scorecard` };
  const href = KPI_PATHS.scorecard(cell.id);
  if (cell.finalPercent === null || !cell.level) {
    return { href, text: PENDING[cell.status] ?? '…', className: 'bg-line-soft text-muted', label: `${when}: ${statusText(cell.status, 'manager').toLowerCase()}, not scored yet` };
  }
  return {
    href,
    text: kpiPercentText(cell.finalPercent),
    className: LEVEL_BADGE[cell.level],
    label: `${when}: ${kpiPercentText(cell.finalPercent)}, ${KPI_LEVEL_LABELS[cell.level]}`,
  };
}

/** A person's latest scored month: its level, and the change from the scored month before ("+3.2", "−1"); null for none. */
export function latestOf(cells: readonly Cell[]): { level: KpiLevel; percent: number; change: string | null } | null {
  const scored = cells.filter((c): c is NonNullable<Cell> & { finalPercent: number; level: KpiLevel } => !!c && c.finalPercent !== null && !!c.level);
  const last = scored.at(-1);
  if (!last) return null;
  const before = scored.at(-2);
  let change: string | null = null;
  if (before) {
    const d = Math.round((last.finalPercent - before.finalPercent) * 10) / 10;
    change = d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
  }
  return { level: last.level, percent: last.finalPercent, change };
}

/** A level's line in the distribution: its name, band, how many and their share of those scored (a whole percent). */
export interface LevelRow {
  level: KpiLevel;
  label: string;
  range: string;
  count: number;
  /** Of those scored, in percent (0 with none scored). */
  share: number;
}

/** The levels from the top down, each counted, with its share of those scored. */
export function levelRows(counts: Readonly<Partial<Record<KpiLevel, number>>>): LevelRow[] {
  const total = LEVELS_DOWN.reduce((n, l) => n + (counts[l] ?? 0), 0);
  return LEVELS_DOWN.map((level) => {
    const count = counts[level] ?? 0;
    return { level, label: KPI_LEVEL_LABELS[level], range: KPI_LEVEL_RANGES[level], count, share: total ? Math.round((count / total) * 1000) / 10 : 0 };
  });
}

/** The distribution in words, for the bar's screen-reader label: "Above expectations 2, Meets expectations 5, …". */
export const levelsLabel = (rows: readonly LevelRow[]) => rows.map((r) => `${r.label} ${r.count}`).join(', ');

/** "4 of 6 scored": those scored of the month's scorecards. */
export const scoredText = (scored: number, total: number) => `${scored} of ${total} scored`;
