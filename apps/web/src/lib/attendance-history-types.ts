import type {
  HISTORY_FIGURE_DEFINITIONS,
  HistoryBin,
  HistoryDay,
  HistoryFigures,
  HistoryFilter,
  HistoryPeriod,
  HistoryTrendPoint,
  HistoryWeekday,
} from '@trendlix/shared';

// A person's attendance history (owner, 23 October 2026: "Attendance history on the profile. Since joining: on-time %,
// average check-in time, late days by weekday and trends; an Excel export"), as the API sends it
// (apps/api/src/attendance/attendance-history.service.ts; the figures and days: packages/shared attendance-history.ts).
// Dates YYYY-MM-DD, moments ISO.

/** GET /attendance/employees/:id/history?period=&from=&to=&only=&page=. */
export interface AttendanceHistoryView {
  employee: { id: string; employeeCode: string; fullNameEn: string; confidential: boolean };
  period: HistoryPeriod;
  periodLabel: string;
  range: { from: string; to: string };
  /** Their first employment's join date: where since joining starts; null: no employment. */
  joinedOn: string | null;
  /** Their employments within the period, oldest first; the days between two are left out (a rehire's gap). */
  employments: { joinDate: string; endDate: string | null }[];
  /** The first and the last day on record in the period; null: none. */
  firstRecord: string | null;
  lastRecord: string | null;
  figures: HistoryFigures;
  /** Each figure in a line. */
  definitions: typeof HISTORY_FIGURE_DEFINITIONS;
  trend: { by: 'month' | 'quarter'; points: HistoryTrendPoint[] };
  /** The first check-ins by 15 minutes (minutes after midnight, Cairo). */
  checkIns: HistoryBin[];
  /** Late days by weekday. */
  weekdays: HistoryWeekday[];
  /** A page of the daily log, latest first, by its filter. */
  log: { only: HistoryFilter | null; page: number; pages: number; pageSize: number; total: number; days: HistoryDay[] };
  generatedAt: string;
}
