import 'server-only';
import type { AttendanceImportSummary, AttendanceImportView } from '@/lib/attendance-types';
import { loadJson, type Loaded } from '../../load';
import { importPath, importsPath } from './attendance';

// Reading a run's attendance imports from Zoho People (owner, 19 October 2026: "Import Zoho now, replace it later"): the
// list on the run's page and an import's review. An API from before them answers 404: "not available yet".

/** GET /payroll/runs/:id/attendance-imports: the run's imports, the latest first (HR and the CEO). */
export function loadImports(runId: string): Promise<Loaded<AttendanceImportSummary[]>> {
  return loadJson<AttendanceImportSummary[]>(importsPath(runId));
}

/** GET /payroll/runs/:id/attendance-imports/:importId: the review. */
export function loadImport(runId: string, importId: string): Promise<Loaded<AttendanceImportView>> {
  return loadJson<AttendanceImportView>(importPath(runId, importId));
}
