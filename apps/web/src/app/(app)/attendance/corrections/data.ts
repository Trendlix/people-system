import 'server-only';
import { cache } from 'react';
import type { AttendanceCorrectionView, CorrectionCounts } from '@/lib/correction-types';
import { loadJson, type Loaded } from '../../payroll/load';
import { CORRECTION_COUNTS, correctionsPath, WAITING_CORRECTIONS, type CorrectionFilter } from './corrections';

// Reading attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check
// out")"): everyone's for Attendance → Corrections (HR and the CEO), those waiting for the caller (My Team, the sidebar),
// the employee's own (My Requests), one for its page. An API from before them answers 404: "not available yet".

export type { Loaded };

/** GET /attendance/corrections: by the filter, of a month or every month. */
export const loadCorrections = (filter: CorrectionFilter, month: string | null = null): Promise<Loaded<AttendanceCorrectionView[]>> => loadJson(correctionsPath(filter, month));

/** Those waiting for the caller. Read once a request. */
export const loadWaitingCorrections = cache(() => loadJson<AttendanceCorrectionView[]>(WAITING_CORRECTIONS));

/** { waiting }: how many wait for the caller. */
export const loadCorrectionCounts = cache(() => loadJson<CorrectionCounts>(CORRECTION_COUNTS));

/** GET /me/attendance/corrections: the employee's own, the latest day first. */
export const loadMyCorrections = cache(() => loadJson<AttendanceCorrectionView[]>('/me/attendance/corrections'));

/** GET /attendance/corrections/:id: for the employee, the one deciding it, HR and the CEO; anyone else gets 404. */
export const loadCorrection = (id: string): Promise<Loaded<AttendanceCorrectionView>> => loadJson(`/attendance/corrections/${encodeURIComponent(id)}`);
