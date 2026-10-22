import {
  ASSET_ATTENTION,
  ASSET_ATTENTION_LABELS,
  ASSET_COUNT_SCOPE_LABELS,
  ASSET_GROUP_LABELS,
  codeFromLabel,
  isAssetCountScope,
  isAssetGroup,
  LABEL_SHEET,
  labelStartProblem,
  type AssetAttention,
  type AssetCountSheetItem,
  type AssetCountSummaryView,
  type AssetDashboardView,
} from '@trendlix/shared';
import { ASSET_PATHS, CUSTODY_PATHS, type CountScopeQuery, type LabelQuery } from '../../../lib/asset-paths';
import { formatDateTime } from '../../../lib/format';

// Assets step 5 on the pages (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard,
// exports) … work on this"; packages/shared asset-counts.ts): reading a count's scope from the address, ticking what is
// typed or scanned on a count's sheet, the words of a count, the dashboard's chips with where each opens, and reading
// the label sheets' choices from the address. Pure code, tested in counts.test.ts.

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The scope of a count from its address (?kind=group&group=kit, ?kind=room&roomId=, ?kind=kit&kitId=); null when it names none. */
export function readCountScope(params: Params): CountScopeQuery | null {
  const kind = one(params.kind);
  if (!isAssetCountScope(kind)) return null;
  if (kind === 'group') {
    const group = one(params.group);
    return isAssetGroup(group) ? { kind, group } : null;
  }
  const id = one(kind === 'room' ? params.roomId : params.kitId);
  if (!id || !UUID.test(id)) return null;
  return kind === 'room' ? { kind, roomId: id } : { kind, kitId: id };
}

/** What happened to what was typed or scanned on a count's sheet. */
export type TickOutcome =
  | { kind: 'ticked'; code: string; name: string }
  | { kind: 'already'; code: string; name: string }
  | { kind: 'out'; code: string; name: string }
  | { kind: 'elsewhere'; code: string }
  | { kind: 'unread' };

/**
 * Ticks what was typed or scanned (a code or a label's address) on a count's sheet: one of its assets is ticked (or
 * was already); one in custody counts as out whatever is ticked; a code not on the sheet, or text that isn't one, is
 * said. Answers the ticked codes after it, and what happened.
 */
export function tickFromText(text: string, items: readonly Pick<AssetCountSheetItem, 'code' | 'name' | 'status'>[], ticked: ReadonlySet<string>): { ticked: Set<string>; outcome: TickOutcome } {
  const code = codeFromLabel(text);
  const next = new Set(ticked);
  if (!code) return { ticked: next, outcome: { kind: 'unread' } };
  const item = items.find((i) => i.code === code);
  if (!item) return { ticked: next, outcome: { kind: 'elsewhere', code } };
  if (item.status === 'custody') return { ticked: next, outcome: { kind: 'out', code, name: item.name } };
  if (next.has(code)) return { ticked: next, outcome: { kind: 'already', code, name: item.name } };
  next.add(code);
  return { ticked: next, outcome: { kind: 'ticked', code, name: item.name } };
}

/** What the sheet says of what was typed or scanned. */
export function tickText(outcome: TickOutcome, scopeLabel: string): string {
  switch (outcome.kind) {
    case 'ticked':
      return `Ticked ${outcome.code} · ${outcome.name}.`;
    case 'already':
      return `${outcome.code} · ${outcome.name} is ticked already.`;
    case 'out':
      return `${outcome.code} · ${outcome.name} is in custody: it counts as out.`;
    case 'elsewhere':
      return `${outcome.code} isn’t counted with ${scopeLabel}. Count it where it is kept.`;
    case 'unread':
      return 'That isn’t an asset’s code. Type it as on the label, e.g. PK-CAM-0003.';
  }
}

/** The codes a count sends: those ticked that are on the sheet and not in custody, by code. */
export const foundCodes = (items: readonly Pick<AssetCountSheetItem, 'code' | 'status'>[], ticked: ReadonlySet<string>): string[] =>
  items
    .filter((i) => i.status !== 'custody' && ticked.has(i.code))
    .map((i) => i.code)
    .sort();

/** How many on the sheet are left unticked (they will be counted missing), custody aside. */
export const untickedCount = (items: readonly Pick<AssetCountSheetItem, 'code' | 'status'>[], ticked: ReadonlySet<string>): number =>
  items.filter((i) => i.status !== 'custody' && !ticked.has(i.code)).length;

/** Asked before saving with some unticked: "2 assets aren’t ticked: they will be counted missing. Save the count?" */
export function saveCountQuestion(unticked: number): string | null {
  if (!unticked) return null;
  return `${unticked} ${unticked === 1 ? 'asset isn’t' : 'assets aren’t'} ticked: ${unticked === 1 ? 'it' : 'they'} will be counted missing. Save the count?`;
}

/** A count in a line: "6 expected · 3 found · 1 missing · 2 out", with how many were marked lost since. */
export function countFiguresText(c: Pick<AssetCountSummaryView, 'expected' | 'found' | 'missing' | 'out' | 'lostMarked'>): string {
  const parts = [`${c.expected} expected`, `${c.found} found`, `${c.missing} missing`, `${c.out} out`];
  if (c.lostMarked) parts.push(`${c.lostMarked} marked lost`);
  return parts.join(' · ');
}

/** Who counted and when: "Counted 22 Oct 2026, 10:05 by Kareem". */
export function countedText(c: Pick<AssetCountSummaryView, 'countedAt' | 'countedBy'>): string {
  return `Counted ${formatDateTime(c.countedAt)}${c.countedBy ? ` by ${c.countedBy.name ?? c.countedBy.email}` : ''}`;
}

/** A scope's kind in words, for the history: "Room", "Kit", "Group". */
export const scopeKindText = (kind: string): string => (isAssetCountScope(kind) ? ASSET_COUNT_SCOPE_LABELS[kind] : kind);

/** The groups a count may be of, in their order, with their words. */
export const COUNT_GROUP_CHOICES = Object.entries(ASSET_GROUP_LABELS).map(([value, label]) => ({ value, label }));

// ---------- the dashboard ----------

/** A chip of the dashboard: its words, its number and the list it opens (none when there is nowhere to go). */
export interface AttentionChip {
  key: AssetAttention;
  label: string;
  count: number;
  href: string | null;
}

/** Where each chip opens (spec §5: "attention chips … each linking to its filtered list"). */
const CHIP_HREF: Record<AssetAttention, string> = {
  overdueReturns: CUSTODY_PATHS.listWith({ filter: 'overdue' }),
  lost: ASSET_PATHS.listWith({ status: 'lost' }),
  // the consumables, those to reorder flagged on each row
  lowStock: ASSET_PATHS.listWith({ group: 'consumable' }),
  countsDue: ASSET_PATHS.counts,
  unsigned: CUSTODY_PATHS.listWith({ filter: 'unsigned' }),
  repair: ASSET_PATHS.listWith({ status: 'repair' }),
  // people leaving who still hold something: what each holds, to receive it back
  clearance: CUSTODY_PATHS.holders,
};

/** The dashboard's chips, in the spec's order; "Employees in clearance" left out while the system has no offboarding. */
export function attentionChips(d: Pick<AssetDashboardView, 'attention'>): AttentionChip[] {
  return ASSET_ATTENTION.flatMap((key) => {
    const count = d.attention[key];
    if (count === null || count === undefined) return [];
    return [{ key, label: ASSET_ATTENTION_LABELS[key], count, href: count > 0 ? CHIP_HREF[key] : null }];
  });
}

// ---------- label sheets ----------

/** The label sheets' choices from the address: "Not labelled yet" unless a search or a filter asks otherwise. */
export function readLabelQuery(params: Params): LabelQuery {
  const group = one(params.group);
  const roomId = one(params.roomId);
  const kitId = one(params.kitId);
  const q = one(params.q);
  const show = one(params.show);
  return {
    unlabelled: show !== 'all',
    group: isAssetGroup(group) ? group : null,
    roomId: roomId && UUID.test(roomId) ? roomId : null,
    kitId: kitId && UUID.test(kitId) ? kitId : null,
    q: q ? q.slice(0, 100) : null,
  };
}

/** The sheets to print from the address: the codes (up to 240, each once, read as codes) and the label to start at. */
export function readLabelPrint(params: Params): { codes: string[]; start: number; startProblem: string | null } {
  const raw = (Array.isArray(params.codes) ? params.codes.join(',') : (params.codes ?? '')).split(',');
  const codes = [...new Set(raw.map((c) => codeFromLabel(c)).filter((c): c is string => c !== null))].slice(0, LABEL_SHEET.maxLabels);
  const startText = one(params.start);
  const start = startText === null ? 1 : Number(startText);
  const startProblem = labelStartProblem(start);
  return { codes, start: startProblem ? 1 : start, startProblem: startText === null ? null : startProblem };
}

/** "24 labels on 1 sheet", "30 labels on 2 sheets", from label `start` on. */
export function sheetsText(labels: number, start = 1): string {
  const sheets = Math.ceil((labels + start - 1) / LABEL_SHEET.perSheet);
  return `${labels} ${labels === 1 ? 'label' : 'labels'} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`;
}
