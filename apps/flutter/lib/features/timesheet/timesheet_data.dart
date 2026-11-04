import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/timesheet.dart';
import '../../providers.dart';

// What the timesheet reads from People and sends to it (owner, 4 November 2026; apps/api timesheets): one's own week,
// its lines saved (all of them at once), the week sent; the weeks waiting for the caller's approval, one week, a decision.

String _week(String? week) => week == null ? '' : '?week=${Uri.encodeComponent(week)}';

/// One's own week: any day of it; null: this week.
final myTimesheetProvider = FutureProvider.autoDispose.family<MyTimesheet, String?>(
  (ref, week) async => MyTimesheet.fromJson(await ref.read(peopleClientProvider).get('/api/me/timesheet${_week(week)}')),
);

/// Whether they log hours on a timesheet (People says no refusal): the Dashboard's Log hours and the menu's row.
final logsHoursProvider = FutureProvider.autoDispose<bool>((ref) async {
  try {
    return MyTimesheet.fromJson(await ref.read(peopleClientProvider).get('/api/me/timesheet')).refusal == null;
  } on ApiException {
    return false;
  }
});

/// The week's lines saved, all of them (what is sent replaces what was).
Future<MyTimesheet> saveTimesheet(WidgetRef ref, String weekStart, List<TimesheetLine> lines) async =>
    MyTimesheet.fromJson(await ref.read(peopleClientProvider).put('/api/me/timesheet${_week(weekStart)}', {'entries': [for (final l in lines) l.toJson()]}));

/// The week sent for approval.
Future<MyTimesheet> submitTimesheet(WidgetRef ref, String weekStart) async => MyTimesheet.fromJson(await ref.read(peopleClientProvider).post('/api/me/timesheet/submit${_week(weekStart)}'));

/// The weeks waiting for the caller's approval; none when they approve nobody's (403, 404).
final waitingTimesheetsProvider = FutureProvider.autoDispose<List<TimesheetListItem>>((ref) async {
  try {
    final json = await ref.read(peopleClientProvider).get('/api/timesheets?status=waiting');
    return [if (json is List) for (final j in json) TimesheetListItem.fromJson(j)].where((w) => w.waitingForYou).toList();
  } on ApiException catch (e) {
    if (e.status == 403 || e.status == 404) return const [];
    rethrow;
  }
});

/// One week, as the one who approves it reads it.
final oneTimesheetProvider = FutureProvider.autoDispose.family<TimesheetWeek, String>(
  (ref, id) async => TimesheetWeek.fromJson(await ref.read(peopleClientProvider).get('/api/timesheets/${Uri.encodeComponent(id)}')),
);

/// Approved, or rejected with why.
Future<TimesheetWeek> decideTimesheet(WidgetRef ref, String id, {required bool approve, String? reason}) async => TimesheetWeek.fromJson(
  await ref.read(peopleClientProvider).post('/api/timesheets/${Uri.encodeComponent(id)}/decide', {'decision': approve ? 'approve' : 'reject', 'comment': ?reason}),
);

/// After a change: the week, the Dashboard's and the approvals' reads again.
void timesheetsChanged(WidgetRef ref) {
  ref
    ..invalidate(myTimesheetProvider)
    ..invalidate(logsHoursProvider)
    ..invalidate(waitingTimesheetsProvider)
    ..invalidate(oneTimesheetProvider);
}
