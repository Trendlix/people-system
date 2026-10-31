import { ApiError, apiGet } from '@/lib/api';
import type { DayRecordsView } from '@/lib/attendance-records';

/** A person's day's records, or why not: not there (404, as the API says it for someone not seen), or refused. */
export async function loadDayRecords(employeeId: string, date: string): Promise<{ kind: 'ok'; value: DayRecordsView } | { kind: 'missing' } | { kind: 'failed'; message: string }> {
  try {
    return { kind: 'ok', value: await apiGet<DayRecordsView>(`/attendance/employees/${encodeURIComponent(employeeId)}/records?date=${encodeURIComponent(date)}`) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return { kind: 'missing' };
    if (err instanceof ApiError) return { kind: 'failed', message: err.messages.join(' ') };
    throw err;
  }
}
