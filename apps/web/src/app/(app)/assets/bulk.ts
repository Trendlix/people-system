// Delete selected and Dispose selected on All Assets (owner, 25 October 2026: "cant i delete assets as a super admin?",
// then "can i delete multiple assets at one?"; asked, "Never-in-custody only"): who gets the ticks, the ticks on a page,
// what a confirm says will be done and skipped (from the rows' status and whether each was ever in custody, as an
// asset's page knows; the rules are packages/shared asset-upkeep.ts), the typed DELETE for more than 10, what a result
// panel says, and a Dispose selected form read into what the API takes. The API checks everything again. Pure code,
// tested; relative imports, as the tests read it.

import {
  ASSETS_BULK_MAX,
  deleteSkipReason,
  disposeProblem,
  reasonBesideCode,
  type AssetRowView,
  type AssetsAccessView,
  type BulkDeleteResult,
  type BulkSkipped,
  type Role,
} from '@trendlix/shared';
import { canDelete } from '../../../lib/roles';
import { isViewOnly, type ViewAs } from '../../../lib/view-as';
import { disposalBody } from './upkeep';

/** What the ticks read of a row of the register. */
export type BulkRow = Pick<AssetRowView, 'code' | 'name' | 'group' | 'status'> & { everInCustody: boolean };

export const bulkRowOf = (r: AssetRowView): BulkRow => ({ code: r.code, name: r.name, group: r.group, status: r.status, everInCustody: r.everInCustody ?? false });

/**
 * Who sees the ticks, and which buttons: Delete selected for a Super Admin (canDelete: never a developer, nor one viewing
 * as someone view only), Dispose selected for an Assets manager (a Super Admin is one) on the same terms. Nobody else
 * gets ticks (a developer sees nothing new).
 */
export function bulkCan(user: { roles: readonly Role[]; developer?: boolean; viewAs?: ViewAs | null }, access: Pick<AssetsAccessView, 'access'>) {
  const can = { delete: canDelete(user), dispose: !user.developer && !isViewOnly(user) && access.access === 'manager' };
  return { ...can, any: can.delete || can.dispose };
}

// ---------- the ticks ----------

/** One row ticked or not. */
export function ticked(selected: ReadonlySet<string>, code: string, on: boolean): Set<string> {
  const next = new Set(selected);
  if (on) next.add(code);
  else next.delete(code);
  return next;
}

/** Every row of the page ticked, or none of them (the others ticked stay as they were). */
export function tickedPage(selected: ReadonlySet<string>, codes: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const c of codes) {
    if (on) next.add(c);
    else next.delete(c);
  }
  return next;
}

/** How "Select all on this page" stands: all ticked, some (shown half ticked) or none. */
export function pageTicks(selected: ReadonlySet<string>, codes: readonly string[]): 'all' | 'some' | 'none' {
  const n = codes.filter((c) => selected.has(c)).length;
  return n === 0 ? 'none' : n === codes.length ? 'all' : 'some';
}

/** The rows ticked that the page still shows, in its order (after an action the list is read again). */
export const tickedRows = (rows: readonly BulkRow[], selected: ReadonlySet<string>): BulkRow[] => rows.filter((r) => selected.has(r.code));

// ---------- the confirms ----------

/** What an action will do with the rows ticked: those it will act on, and those it will skip with the reason. */
export interface BulkForecast {
  will: BulkRow[];
  skipped: BulkSkipped[];
}

/** Delete selected: those never in custody are deleted; one in custody now, or that was, skipped. */
export function deleteForecast(rows: readonly BulkRow[]): BulkForecast {
  const out: BulkForecast = { will: [], skipped: [] };
  for (const r of rows) {
    const reason = deleteSkipReason(r);
    if (reason) out.skipped.push({ code: r.code, reason });
    else out.will.push(r);
  }
  return out;
}

/** Dispose selected: never one in custody, a consumable, or one disposed already (the disposal date is checked on send). */
export function disposeForecast(rows: readonly BulkRow[]): BulkForecast {
  const out: BulkForecast = { will: [], skipped: [] };
  for (const r of rows) {
    const problem = disposeProblem(r);
    if (problem) out.skipped.push({ code: r.code, reason: reasonBesideCode(r.code, problem) });
    else out.will.push(r);
  }
  return out;
}

/** More than this many to delete asks for DELETE typed. */
export const TYPE_TO_DELETE_OVER = 10;
export const TYPE_TO_DELETE = 'DELETE';

export const needsTypedDelete = (deleting: number): boolean => deleting > TYPE_TO_DELETE_OVER;

/** DELETE typed as asked (spaces around it aside). */
export const typedDelete = (typed: string): boolean => typed.trim() === TYPE_TO_DELETE;

/** "1 asset", "12 assets". */
export const assetsText = (n: number): string => `${n} ${n === 1 ? 'asset' : 'assets'}`;

/** What the Delete selected confirm says first. */
export function deleteConfirmText(f: BulkForecast): string {
  const skip = f.skipped.length ? ` ${f.skipped.length} will be skipped: only an asset never in custody can be deleted.` : '';
  if (!f.will.length) return `None of them can be deleted.${skip}`;
  return `${assetsText(f.will.length)} will be deleted, with their photos. Their codes are never given again. This can’t be undone.${skip}`;
}

/** What the Dispose selected confirm says first. */
export function disposeConfirmText(f: BulkForecast): string {
  const skip = f.skipped.length ? ` ${f.skipped.length} will be skipped.` : '';
  if (!f.will.length) return `None of them can be disposed of.${skip}`;
  return `${assetsText(f.will.length)} will be disposed of. They stay on record but leave every total and list.${skip}`;
}

// ---------- the result ----------

/** A reason in brackets after its code: "it was in custody: dispose of it instead". */
export const bracketed = (reason: string): string => reason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/** "PK-CAM-0004 (it was in custody: dispose of it instead)". */
export const skippedText = (s: BulkSkipped): string => `${s.code} (${bracketed(s.reason)})`;

/**
 * What the result panel says: "Deleted 12. Skipped 3: PK-CAM-0004 (it was in custody: dispose of it instead), …", the
 * first `shown` skipped named and how many more (the panel lists them all below).
 */
export function bulkDoneText(verb: 'Deleted' | 'Disposed of', done: number, skipped: readonly BulkSkipped[], shown = 5): string {
  const head = `${verb} ${done}.`;
  if (!skipped.length) return head;
  const named = skipped.slice(0, shown).map(skippedText).join(', ');
  const more = skipped.length > shown ? `, and ${skipped.length - shown} more` : '';
  return `${head} Skipped ${skipped.length}: ${named}${more}.`;
}

/** Of what Delete selected skipped, those that can be disposed of instead ("Dispose these 3"), as the page shows them. */
export function disposableSkipped(result: Pick<BulkDeleteResult, 'skipped'>, rows: readonly BulkRow[]): string[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return result.skipped.map((s) => byCode.get(s.code)).filter((r): r is BulkRow => !!r && disposeProblem(r) === null).map((r) => r.code);
}

/** The button for those: "Dispose these 3", or "Dispose of it" for one. */
export const disposeTheseText = (n: number): string => (n === 1 ? 'Dispose of it' : `Dispose these ${n}`);

// ---------- sending ----------

/** Why the codes can't be sent, or null: at least one, at most 200 (a page has 50). */
export function codesProblem(codes: readonly string[]): string | null {
  if (!codes.length) return 'Tick the assets first.';
  if (codes.length > ASSETS_BULK_MAX) return `Choose at most ${ASSETS_BULK_MAX} assets at a time.`;
  return null;
}

/**
 * The Dispose selected form read as one disposal's is (upkeep.ts disposalBody: how, the day, today when empty, who
 * approved it, a note), into what POST /assets/bulk-dispose takes; no amount (Finance sets each one's later).
 */
export function bulkDisposeBody(codes: readonly string[], fd: Pick<FormData, 'get'>, today: string): { body: Record<string, unknown>; problems: string[] } {
  const { body, problems } = disposalBody(fd, { values: false, today, purchaseDate: null });
  const codeProblem = codesProblem(codes);
  return {
    body: { codes: [...codes], method: body.method, date: body.on, approvedBy: body.approvedBy, ...(body.notes ? { note: body.notes } : {}) },
    problems: codeProblem ? [codeProblem, ...problems] : problems,
  };
}

/** The Dispose selected form's fields, kept when it is refused. */
export const BULK_DISPOSE_FIELDS = ['method', 'on', 'approvedBy', 'notes'] as const;
