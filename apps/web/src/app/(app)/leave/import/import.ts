import { LEAVE_IMPORT_MAX_MB, LEAVE_IMPORT_ROW_STATUS_LABELS, signedDays, type LeaveImportRowStatus, type Role } from '@trendlix/shared';
import { LEAVE_PATH } from '../../../../components/nav';
import { formatDate, formatDateTime } from '../../../../lib/format';
import type { LeaveImportHistoryRow, LeaveImportPerson, LeaveImportRow, LeaveImportView } from '../../../../lib/leave-import-types';
import { hasRole } from '../../../../lib/roles';

// Importing leave in bulk, on Leave Requests (owner, 21 October 2026: "how to import bulk leaves?"; he chose "Both", the
// leave taken and the balances, and "Our Excel template"; Zoho People's leave export too): the addresses, who imports,
// the upload's quick checks, the review's sections, counts and words, and the history's. Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths. The API decides every row.

type WithRoles = { roles: readonly Role[] };

export const LEAVE_IMPORT_PATH = `${LEAVE_PATH}/import`;
export const leaveImportHref = (id: string) => `${LEAVE_IMPORT_PATH}/${encodeURIComponent(id)}`;
/** The template, served under the web domain with the caller's session. A plain link, never prefetched. */
export const LEAVE_IMPORT_TEMPLATE_HREF = `${LEAVE_IMPORT_PATH}/template`;
/** After a Super Admin deleted one: the list says so. */
export const LEAVE_IMPORT_DELETED_HREF = `${LEAVE_IMPORT_PATH}?deleted=1`;

/** HR imports leave, and the CEO the C-level people's (owner, 19 October 2026); the API checks whose rows each applies. */
export const importsLeave = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

export const UPLOAD_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Why a file chosen can't be uploaded, before it is sent (the API reads it by its content again); null: it can. */
export function uploadProblem(file: Pick<File, 'name' | 'size'> | null | undefined): string | null {
  if (!file || file.size === 0) return 'Choose the file to import: the leave template filled in, or Zoho People’s leave export (.xlsx).';
  if (!/\.xlsx$/i.test(file.name)) return 'Choose an Excel workbook (.xlsx): the leave template filled in, or Zoho People’s leave export saved as XLSX.';
  if (file.size > LEAVE_IMPORT_MAX_MB * 1024 * 1024) return `The file must be ${LEAVE_IMPORT_MAX_MB} MB or smaller.`;
  return null;
}

// ---------- the review ----------

/** The order the review lists rows in: those to act on first. */
const ORDER: readonly LeaveImportRowStatus[] = ['problem', 'waiting', 'ready', 'duplicate', 'applied', 'skipped'];

/** How a status looks: its badge's colours. */
export const STATUS_TONE: Record<LeaveImportRowStatus, string> = {
  ready: 'bg-accent-soft text-accent',
  applied: 'bg-ok-soft text-ok',
  waiting: 'bg-warn-soft text-warn',
  problem: 'bg-danger-soft text-danger',
  duplicate: 'bg-line-soft text-muted',
  skipped: 'bg-line-soft text-muted',
};

export const statusLabel = (r: Pick<LeaveImportRow, 'status' | 'pending'>) => (r.status === 'ready' && r.pending ? 'Ready: a request' : LEAVE_IMPORT_ROW_STATUS_LABELS[r.status]);

/** The rows in the order to act on them: by status, then by their row in the file. */
export function orderedRows(rows: readonly LeaveImportRow[]): LeaveImportRow[] {
  return [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.row - b.row);
}

/** The count chips over the review: each status with rows, the pending among the ready, and the C-level rows hidden. */
export function countChips(view: Pick<LeaveImportView, 'counts'>): { key: string; label: string; count: number }[] {
  const chips: { key: string; label: string; count: number }[] = ORDER.filter((s) => view.counts[s] > 0).map((s) => ({ key: s, label: LEAVE_IMPORT_ROW_STATUS_LABELS[s], count: view.counts[s] }));
  if (view.counts.pending > 0) chips.splice(chips.findIndex((c) => c.key === 'ready') + 1, 0, { key: 'pending', label: 'Of them requests', count: view.counts.pending });
  return chips;
}

/** A row's days: "05/03/2026" or "05/03/2026 – 07/03/2026", the half day said. */
export function whenText(r: Pick<LeaveImportRow, 'from' | 'to' | 'fromText' | 'toText' | 'halfDay'>): string {
  const from = r.from ? formatDate(r.from) : r.fromText || '—';
  const to = r.to ? formatDate(r.to) : r.toText || '—';
  return `${from === to ? from : `${from} – ${to}`}${r.halfDay ? ' (half day)' : ''}`;
}

export const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The days a row counts, and the file's own figure when it is another. */
export function rowDaysText(r: Pick<LeaveImportRow, 'days' | 'fileDays'>): string {
  if (r.days === null) return r.fileDays === null ? '—' : `${daysText(r.fileDays)} in the file`;
  return r.fileDays !== null && Math.round(r.fileDays * 10) !== Math.round(r.days * 10) ? `${daysText(r.days)} (the file: ${r.fileDays})` : daysText(r.days);
}

/** What a balance row adds or takes: "+2.5 days", "−1 day"; none worked out yet: null. */
export const adjustmentText = (r: Pick<LeaveImportRow, 'adjustment'>) => (r.adjustment === null ? null : signedDays(r.adjustment));

/** Who a row is, as the file names them and as matched. */
export function rowPersonText(r: Pick<LeaveImportRow, 'employee' | 'nameInFile' | 'code'>): { name: string; detail: string | null } {
  if (r.employee) return { name: r.employee.fullNameEn, detail: r.nameInFile && r.nameInFile !== r.employee.fullNameEn ? `In the file: ${r.nameInFile}` : r.employee.employeeCode };
  return { name: r.nameInFile || r.code || 'No name', detail: r.code && r.nameInFile ? r.code : null };
}

/** How a person of the file was matched, in words. */
export const MATCH_TEXT: Record<LeaveImportPerson['match'], string> = {
  code: 'Matched by their employee code',
  linked: 'Matched by their Zoho ID',
  exact: 'Their name, written alike',
  close: 'Close to a name: did you mean …?',
  none: 'Not found',
  confirmed: 'Chosen by you',
  skipped: 'Skipped',
};

/** The people HR says who they are first: a name to confirm, or not found. */
export const peopleToConfirm = (view: Pick<LeaveImportView, 'people'>) => view.people.filter((p) => p.toConfirm && p.match !== 'skipped');
/** The people HR chose, or skipped: each can be undone. */
export const peopleChosen = (view: Pick<LeaveImportView, 'people'>) => view.people.filter((p) => p.match === 'confirmed' || p.match === 'skipped');

/** What a person of the file is known by: their code, Zoho ID, or the number Zoho shows. */
export function personIds(p: Pick<LeaveImportPerson, 'code' | 'zohoId' | 'hint'>): string | null {
  const parts = [p.code && `Code ${p.code}`, p.zohoId && `Zoho ID ${p.zohoId}`, p.hint && `Zoho number ${p.hint}?`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The rows the caller would apply now: ready, theirs. */
export const dueRows = (view: Pick<LeaveImportView, 'leaves' | 'balances'>) => [...view.leaves, ...view.balances].filter((r) => r.status === 'ready' && r.yours);

/** What Apply asks first. */
export function applyConfirmText(view: Pick<LeaveImportView, 'leaves' | 'balances'>): string {
  const due = dueRows(view);
  const leaves = due.filter((r) => r.sheet === 'leaves');
  const requests = leaves.filter((r) => r.pending).length;
  const balances = due.length - leaves.length;
  const parts = [
    leaves.length - requests ? `${leaves.length - requests} ${leaves.length - requests === 1 ? 'leave' : 'leaves'} as approved` : null,
    requests ? `${requests} pending ${requests === 1 ? 'request' : 'requests'} sent for a decision` : null,
    balances ? `${balances} ${balances === 1 ? 'balance' : 'balances'} set` : null,
  ].filter(Boolean);
  return `Apply ${parts.join(', ')}? The draft payrolls of their months take the leave; a payroll with the CEO, approved or paid doesn’t change. You can undo it while no payroll counting it is past its draft.`;
}

export function undoConfirmText(view: Pick<LeaveImportView, 'undoable'>): string {
  return `Undo this import? The ${view.undoable === 1 ? 'leave or balance change' : `${view.undoable} leaves and balance changes`} it made that you import are removed, and its rows can be imported again.`;
}

export function deleteConfirmText(fileName: string): string {
  return `Delete the import of ${fileName}? The file and its review are deleted for good; nothing it made is left in the system.`;
}

/** Why a Super Admin can't delete an import yet; null: they can. */
export const deleteBlocked = (kept: { leaves: number; adjustments: number }) => (kept.leaves + kept.adjustments > 0 ? 'Undo it first: what it made is still in the system.' : null);

/** What a person's choice form sends, read back: an employee, skip, or undo (back to the match). Null: nothing chosen. */
export function personChoice(fd: FormData): { key: string; employeeId: string | null } | { key: string; skipped: true } | null {
  const key = String(fd.get('key') ?? '');
  if (!key) return null;
  const choice = String(fd.get('choice') ?? '');
  if (choice === 'skip') return { key, skipped: true };
  if (choice === 'undo') return { key, employeeId: null };
  const employeeId = String(fd.get('employeeId') ?? '');
  return /^[0-9a-f-]{36}$/i.test(employeeId) ? { key, employeeId } : null;
}

/** What a Zoho type's form sends, read back: a type, skip, or back to the default. Null: neither. */
export function typeChoice(fd: FormData): { zohoType: string; typeId: string } | { zohoType: string; skipped: true } | { zohoType: string } | null {
  const zohoType = String(fd.get('zohoType') ?? '');
  if (!zohoType) return null;
  const value = String(fd.get('typeId') ?? '');
  if (value === 'skip') return { zohoType, skipped: true };
  if (value === 'default') return { zohoType };
  return /^[0-9a-f-]{36}$/i.test(value) ? { zohoType, typeId: value } : null;
}

// ---------- the history ----------

/** "12 leaves and 3 balances": a file's rows. */
export function historyRowsText(r: Pick<LeaveImportHistoryRow, 'rows'>): string {
  const parts = [r.rows.leaves ? `${r.rows.leaves} ${r.rows.leaves === 1 ? 'leave' : 'leaves'}` : null, r.rows.balances ? `${r.rows.balances} ${r.rows.balances === 1 ? 'balance' : 'balances'}` : null].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'No rows';
}

/** Where an import stands: applied (what is left of it), undone, or not applied. */
export function historyStateText(r: Pick<LeaveImportHistoryRow, 'state' | 'kept' | 'appliedAt' | 'appliedBy' | 'undoneAt' | 'undoneBy'>): string {
  if (r.state === 'applied') {
    const made = [r.kept.leaves ? `${r.kept.leaves} ${r.kept.leaves === 1 ? 'leave' : 'leaves'}` : null, r.kept.adjustments ? `${r.kept.adjustments} ${r.kept.adjustments === 1 ? 'balance' : 'balances'}` : null]
      .filter(Boolean)
      .join(' and ');
    return `Applied ${formatDateTime(r.appliedAt)}${r.appliedBy ? ` by ${r.appliedBy}` : ''}: ${made}`;
  }
  if (r.state === 'undone') return `Undone ${formatDateTime(r.undoneAt)}${r.undoneBy ? ` by ${r.undoneBy}` : ''}`;
  return 'Not applied';
}

/** The notice after a Super Admin deleted an import (?deleted=1). */
export const deletedNotice = (query: Record<string, string | string[] | undefined>) => (query.deleted === '1' ? 'The import was deleted.' : null);
