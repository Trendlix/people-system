import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/attendance_correction.dart';
import '../../models/my_attendance.dart';
import '../../providers.dart';
import '../dashboard/dashboard_data.dart';

// What the Attendance tab reads from People and sends to it: the employee's own month in full (the Dashboard's read of
// GET /api/attendance/me, shared, so this month is read once), their corrections, asking for one and cancelling one.

/// The time now, for the tab's today and month and a time not yet come (a test sets it).
final attendanceClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// A month of one's attendance in full, "2026-10".
final myMonthProvider = FutureProvider.autoDispose.family<MyMonth, String>((ref, month) async {
  final m = await ref.watch(attendanceMonthProvider(month).future);
  return MyMonth.fromJson(m.raw);
});

/// One's attendance corrections, the latest day first (GET /api/me/attendance/corrections).
final myCorrectionsProvider = FutureProvider.autoDispose<List<AttendanceCorrection>>(
  (ref) async => correctionsOf(await ref.read(peopleClientProvider).get('/api/me/attendance/corrections')),
);

/// Ask to correct a day (POST /api/me/attendance/corrections): People checks the day, the month's payroll and the times
/// again and refuses in its words (an ApiException). Once sent, the month, the corrections and the open requests' count
/// are read again.
Future<AttendanceCorrection> askForCorrection(WidgetRef ref, Map<String, Object> body) async {
  final made = AttendanceCorrection.fromJson(await ref.read(peopleClientProvider).post('/api/me/attendance/corrections', body));
  ref
    ..invalidate(attendanceMonthProvider(made.date.substring(0, 7)))
    ..invalidate(myCorrectionsProvider)
    ..invalidate(openRequestsProvider);
  return made;
}

/// Cancel one's correction while it is being decided (POST /api/me/attendance/corrections/:id/cancel).
Future<void> cancelCorrection(WidgetRef ref, AttendanceCorrection c) async {
  try {
    await ref.read(peopleClientProvider).post('/api/me/attendance/corrections/${Uri.encodeComponent(c.id)}/cancel');
  } finally {
    // moved on meanwhile or not: where it stands now
    ref
      ..invalidate(myCorrectionsProvider)
      ..invalidate(attendanceMonthProvider(c.date.substring(0, 7)))
      ..invalidate(openRequestsProvider);
  }
}
