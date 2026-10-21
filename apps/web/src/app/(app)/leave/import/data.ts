import 'server-only';
import type { LeaveImportHistoryRow, LeaveImportView } from '@/lib/leave-import-types';
import { loadJson, type Loaded } from '../../payroll/load';

// Reading leave imports (owner, 21 October 2026: "how to import bulk leaves?"): the history and an import's review. An
// API from before them answers 404: "not available yet".

/** GET /leave/import: every import, the latest first (HR and the CEO). */
export function loadLeaveImports(): Promise<Loaded<LeaveImportHistoryRow[]>> {
  return loadJson<LeaveImportHistoryRow[]>('/leave/import');
}

/** GET /leave/import/:id: the review. */
export function loadLeaveImport(id: string): Promise<Loaded<LeaveImportView>> {
  return loadJson<LeaveImportView>(`/leave/import/${encodeURIComponent(id)}`);
}
