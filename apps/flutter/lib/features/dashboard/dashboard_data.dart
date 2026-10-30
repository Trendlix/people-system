import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../models/attendance_month.dart';
import '../../models/holiday.dart';
import '../../models/kpi.dart';
import '../../models/leave.dart';
import '../../models/profile.dart';
import '../../providers.dart';

// What the Dashboard reads from People, one provider a card, so each loads, fails and refreshes on its own. Only the
// employee's own, as the API answers them; the Requests, Attendance and Profile tabs read theirs as they need.

/// The year's leave balance (GET /api/me/leave/balances).
final balancesProvider = FutureProvider.autoDispose.family<LeaveBalances, int>(
  (ref, year) async => LeaveBalances.fromJson(await ref.read(peopleClientProvider).get('/api/me/leave/balances?year=$year')),
);

/// A month of one's attendance (GET /api/attendance/me), "2026-10".
final attendanceMonthProvider = FutureProvider.autoDispose.family<AttendanceMonth, String>(
  (ref, month) async => AttendanceMonth.fromJson(await ref.read(peopleClientProvider).get('/api/attendance/me?month=$month')),
);

/// A year's official holidays (GET /api/payroll/holidays).
final holidaysProvider = FutureProvider.autoDispose.family<List<HolidayDay>, int>((ref, year) async {
  final json = await ref.read(peopleClientProvider).get('/api/payroll/holidays?year=$year');
  return json is List ? json.map(HolidayDay.fromJson).toList() : const [];
});

/// One's own employee profile (GET /api/employees/:id); none for an account without one.
final ownProfileProvider = FutureProvider.autoDispose<OwnProfile?>((ref) async {
  final auth = ref.watch(authProvider).value;
  final id = auth is SignedIn ? auth.me.employeeId : null;
  if (id == null) return null;
  return OwnProfile.fromJson(await ref.read(peopleClientProvider).get('/api/employees/$id'));
});

/// How many of one's requests are still being decided: leave, permission, reimbursements and attendance corrections
/// (the statuses packages/shared counts as open). A kind that can't be read counts none.
final openRequestsProvider = FutureProvider.autoDispose<int>((ref) async {
  final client = ref.read(peopleClientProvider);
  Future<int> count(String path, Set<String> open) async {
    try {
      final list = await client.get(path);
      return list is List ? list.where((r) => r is Map && open.contains(r['status'])).length : 0;
    } on Object {
      return 0;
    }
  }

  const deciding = {'with_manager', 'with_hr'};
  final counts = await Future.wait([
    count('/api/me/leave/requests', deciding),
    count('/api/me/permissions', deciding),
    count('/api/me/reimbursements', {...deciding, 'with_finance'}),
    count('/api/me/attendance/corrections', deciding),
  ]);
  return counts.fold<int>(0, (a, b) => a + b);
});

/// One's own KPI scorecards (GET /api/kpis/scorecards/mine), newest first.
final myKpisProvider = FutureProvider.autoDispose<List<KpiScorecard>>(
  (ref) async => kpiScorecardsOf(await ref.read(peopleClientProvider).get('/api/kpis/scorecards/mine')),
);
