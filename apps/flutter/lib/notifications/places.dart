import '../models/requests.dart';

// Where a notification opens in the app (owner, 8 November 2026: "notifications are not working correctly"): People
// gives each one a link on the website (apps/api notices.service.ts REQUEST_LINKS, kpi-notices.service.ts,
// timesheets); the app opens the same thing on its own screens: a request's page, a week of hours, a tab. What the app
// has no screen for (a payslip, a raise, a home location's map) stays in the bell's list.

sealed class NotificationPlace {
  const NotificationPlace();
}

/// A request's page (leave, permission, correction, working from home, official duty, compensatory day, claim, home
/// location, resignation).
class RequestPlace extends NotificationPlace {
  const RequestPlace(this.kind, this.id);

  final RequestKind kind;
  final String id;

  @override
  bool operator ==(Object other) => other is RequestPlace && other.kind == kind && other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);

  @override
  String toString() => 'RequestPlace($kind, $id)';
}

/// A week of hours (timesheets, 4 November 2026).
class WeekPlace extends NotificationPlace {
  const WeekPlace(this.id);

  final String id;

  @override
  bool operator ==(Object other) => other is WeekPlace && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'WeekPlace($id)';
}

/// One of the app's addresses: a tab (/requests, where To approve is), or a screen under one.
class ScreenPlace extends NotificationPlace {
  const ScreenPlace(this.path);

  final String path;

  @override
  bool operator ==(Object other) => other is ScreenPlace && other.path == path;

  @override
  int get hashCode => path.hashCode;

  @override
  String toString() => 'ScreenPlace($path)';
}

/// The kinds waiting for the person's decision that the app's To approve lists (approvals.dart; packages/shared
/// WAITING_KINDS less raises, pay raises, home locations and KPIs, which are decided on the website): the "waiting for
/// you" popup shows them.
const popupKinds = {
  'leave_waiting',
  'permission_waiting',
  'reimbursement_waiting',
  'correction_waiting',
  'wfh_waiting',
  'od_waiting',
  'compensatory_waiting',
  'timesheet_waiting',
  // a stand-in's requests waiting (25 October 2026)
  'stand_in',
};

final _requestLinks = <(RegExp, RequestKind)>[
  (RegExp(r'^/leave/permissions/([^/]+)$'), RequestKind.permission),
  (RegExp(r'^/leave/([^/]+)$'), RequestKind.leave),
  (RegExp(r'^/attendance/corrections/([^/]+)$'), RequestKind.correction),
  (RegExp(r'^/attendance/wfh/([^/]+)$'), RequestKind.wfh),
  (RegExp(r'^/attendance/official-duty/([^/]+)$'), RequestKind.od),
  (RegExp(r'^/attendance/compensatory/([^/]+)$'), RequestKind.compensatory),
  (RegExp(r'^/reimbursements/([^/]+)$'), RequestKind.claim),
  (RegExp(r'^/home-locations/([^/]+)$'), RequestKind.home),
  (RegExp(r'^/resignations/([^/]+)$'), RequestKind.resignation),
];

/// Where a notification of [kind] with [link] opens; null: nowhere in the app (it stays in the bell's list).
NotificationPlace? placeOf(String link, String kind) {
  final path = link.split(RegExp('[?#]')).first;
  for (final (pattern, requestKind) in _requestLinks) {
    final m = pattern.firstMatch(path);
    // "/leave/permissions" alone is the list, not a leave
    if (m != null && !(requestKind == RequestKind.leave && m.group(1) == 'permissions')) return RequestPlace(requestKind, Uri.decodeComponent(m.group(1)!));
  }
  final week = RegExp(r'^/timesheets/([^/]+)$').firstMatch(path);
  if (week != null) return WeekPlace(Uri.decodeComponent(week.group(1)!));
  if (path == '/kpis/team') return const ScreenPlace('/dashboard/performance/team');
  if (path.startsWith('/kpis') || kind.startsWith('kpi_')) return const ScreenPlace('/dashboard/performance');
  if (path == '/timesheets' || kind.startsWith('timesheet')) return const ScreenPlace('/dashboard/timesheet');
  if (path == '/my-attendance' || path.startsWith('/attendance')) return const ScreenPlace('/attendance');
  if (path == '/my-custody') return const ScreenPlace('/profile/assets');
  if (kind == 'check_in_reminder' || kind == 'check_out_reminder') return const ScreenPlace('/dashboard');
  if (path == '/approvals' || path == '/leave' || path == '/my-team' || path == '/my-requests' || path.startsWith('/leave/')) return const ScreenPlace('/requests');
  // something waiting for them in To approve, on the Requests tab
  if (popupKinds.contains(kind)) return const ScreenPlace('/requests');
  return null;
}
