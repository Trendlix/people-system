import type { HolidayImportDay, HolidayImportPreview, HolidayImportResult, HolidayImportStatus } from '../../../../lib/types';

// Importing a year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"),
// on Organization → Holidays: HR or Admin downloads the template, fills it in, and imports it in two steps. The API
// reads the file and answers each day with what would happen to it, nothing saved (the preview, grouped here); then
// "Import N holidays" sends the same file again with the preview's fingerprint, and the API adds the new days. Pure
// code, tested; relative imports, as vitest doesn't know the "@/" paths.

/** The largest file the API takes (1 MB): a year's holidays take a few kilobytes. */
export const IMPORT_MAX_MB = 1;
export const IMPORT_MAX_BYTES = IMPORT_MAX_MB * 1024 * 1024;
/** The most rows of holidays one file can have (the API's). */
export const IMPORT_MAX_ROWS = 500;
/** What the file box takes. The API tells the two apart by their content, not their names. */
export const IMPORT_ACCEPT = '.xlsx,.csv';

/** Where the template is downloaded (a plain link, never prefetched), its example row in the year shown. */
export const templateHref = (year: number) => `/organization/holidays/template?year=${year}`;

/** What the form says of the chosen file before sending it: neither a workbook nor a CSV file, or too large; '' when it can go. */
export function importFileProblem(file: Pick<File, 'name' | 'size'>): string {
  if (!/\.(xlsx|csv)$/i.test(file.name.trim())) return 'Choose an Excel workbook (.xlsx) or a CSV file (.csv), such as the template filled in.';
  if (file.size > IMPORT_MAX_BYTES) return `The file must be ${IMPORT_MAX_MB} MB or smaller.`;
  return '';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" */
const listed = (parts: readonly string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? ''));

/** A group of the preview: the days that go one way, under a heading in Title Case and a line on what happens to them. */
export interface ImportGroup {
  status: HolidayImportStatus;
  title: string;
  intro: string;
  days: HolidayImportDay[];
}

const GROUPS: readonly Omit<ImportGroup, 'days'>[] = [
  { status: 'new', title: 'New', intro: 'Added when you import.' },
  { status: 'on_file', title: 'Already on File', intro: 'The same day and name are on file already: skipped.' },
  {
    status: 'clash',
    title: 'Clashes',
    intro: 'Another holiday is on file on these days: not imported. If the file is right, change or remove the one on file, then import the file again.',
  },
  { status: 'duplicate', title: 'In the File Twice', intro: 'The day is given again further down the file: only the first counts.' },
];

/** The preview's days by what happens to them, in that order (new, already on file, clashes, in the file twice); empty groups left out. */
export function importGroups(preview: Pick<HolidayImportPreview, 'days'>): ImportGroup[] {
  return GROUPS.map((g) => ({ ...g, days: preview.days.filter((d) => d.status === g.status) })).filter((g) => g.days.length > 0);
}

/** How many of the file's days go each way, and how many rows have problems. */
export function importCounts(preview: Pick<HolidayImportPreview, 'days' | 'problems'>): Record<HolidayImportStatus, number> & { problemRows: number } {
  const count = (status: HolidayImportStatus) => preview.days.filter((d) => d.status === status).length;
  return { new: count('new'), on_file: count('on_file'), clash: count('clash'), duplicate: count('duplicate'), problemRows: new Set(preview.problems.map((p) => p.row)).size };
}

/** The days not imported, and the rows: ["1 already on file", "2 clashes", "1 row with a problem"]; none left out: []. */
function leftOut(preview: Pick<HolidayImportPreview, 'days' | 'problems'>): string[] {
  const c = importCounts(preview);
  return [
    c.on_file ? `${c.on_file} already on file` : '',
    c.clash ? plural(c.clash, 'clash', 'clashes') : '',
    c.duplicate ? `${c.duplicate} in the file twice` : '',
    c.problemRows ? plural(c.problemRows, 'row with a problem', 'rows with problems') : '',
  ].filter(Boolean);
}

/** The preview in a sentence: "Read 7 rows: 5 new days, 1 already on file, 1 clash and 2 rows with problems." */
export function previewSummary(preview: Pick<HolidayImportPreview, 'rows' | 'days' | 'problems'>): string {
  const fresh = importCounts(preview).new;
  const rest = leftOut(preview);
  const parts = fresh || !rest.length ? [plural(fresh, 'new day', 'new days'), ...rest] : rest;
  return `Read ${plural(preview.rows, 'row', 'rows')}: ${listed(parts)}.`;
}

/** The import button: "Import 1 holiday", "Import 5 holidays". */
export const importButtonText = (n: number) => `Import ${plural(n, 'holiday', 'holidays')}`;

/** What the table says of a day beside its names: the holiday on file that day, or the row that gives it first. */
export function dayNote(day: HolidayImportDay): string {
  if (day.status === 'clash' && day.onFile) return `On file: ${day.onFile.nameEn}`;
  if (day.status === 'duplicate' && day.firstRow !== undefined) return `First on row ${day.firstRow}`;
  return '';
}

/** The years the import added holidays in, in order. */
export const importedYears = (result: Pick<HolidayImportResult, 'imported'>) => [...new Set(result.imported.map((h) => Number(h.date.slice(0, 4))))].sort((a, b) => a - b);

/**
 * The answer once imported: "Imported 5 holidays in 2027. Left out: 1 already on file and 1 clash. Runs made or
 * refreshed from now on count them."; or, when none was new by then, that nothing was.
 */
export function importedMessage(result: Pick<HolidayImportResult, 'imported' | 'days' | 'problems'>): string {
  const rest = listed(leftOut(result));
  if (!result.imported.length) return `Nothing was imported: no day in the file is new now${rest ? ` (${rest})` : ''}.`;
  const years = listed(importedYears(result).map(String));
  return `Imported ${plural(result.imported.length, 'holiday', 'holidays')} in ${years}.${rest ? ` Left out: ${rest}.` : ''} Runs made or refreshed from now on count ${result.imported.length === 1 ? 'it' : 'them'}.`;
}
