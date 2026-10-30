import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/requests/requests_data.dart';
import 'package:people/providers.dart';
import 'package:people/theme/app_theme.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';

// People's answers for the Requests tab's tests, as apps/api sends them to an employee (realistic: their own
// requests of every kind, the forms, the balances), and the tab opened in the app signed in.

/// This year, so "Requests this year" counts the fixtures whenever the tests run.
final y = DateTime.now().year;

Map<String, Object?> approverJson({String name = 'Sara Ali', String role = 'direct_manager'}) => {'id': 'm1', 'fullNameEn': name, 'role': role};

Map<String, Object?> employeeJson() => {
  'id': 'e1',
  'employeeCode': 'TL-014',
  'fullNameEn': 'Hazem Soliman',
  'fullNameAr': 'حازم سليمان',
  'department': 'Production',
  'team': 'Video',
};

Map<String, Object?> stepJson(String kind, {String? decision, String? actor = 'Hazem Soliman', String at = '', String? comment}) => {
  'id': 's-$kind',
  'kind': kind,
  'decision': decision,
  'comment': comment,
  'actor': actor,
  'onBehalfOf': null,
  'at': at.isEmpty ? '$y-10-26T07:05:00.000Z' : at,
};

Map<String, Object?> leaveJson({
  String id = 'l1',
  String status = 'with_manager',
  String type = 'Annual leave',
  String typeKey = 'annual',
  String start = '',
  String end = '',
  double days = 3,
  bool recordedByHr = false,
  bool canCancel = true,
  String createdAt = '',
}) => {
  'id': id,
  'employee': employeeJson(),
  'type': {'id': 't-$typeKey', 'key': typeKey, 'nameEn': type, 'nameAr': 'إجازة', 'paid': 'paid'},
  'startDate': start.isEmpty ? '$y-11-02' : start,
  'endDate': end.isEmpty ? '$y-11-04' : end,
  'halfDay': false,
  'days': days,
  'reason': 'Family trip',
  'status': status,
  'stage': status == 'with_manager' ? 'manager' : (status == 'with_hr' ? 'hr' : null),
  'waitingForYou': false,
  'canCancel': canCancel,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'recordedByHr': recordedByHr,
  'documents': <Object>[],
  'steps': [if (recordedByHr) stepJson('recorded_by_hr', actor: 'Mona HR') else stepJson('submitted')],
  'balanceAfter': 16,
  'createdAt': createdAt.isEmpty ? '$y-10-26T07:05:00.000Z' : createdAt,
  'cover': null,
  'handoverNote': null,
  'confidential': false,
};

Map<String, Object?> permissionJson({String id = 'p1', String status = 'approved', String date = ''}) => {
  'id': id,
  'kind': 'permission',
  'employee': employeeJson(),
  'type': {'id': 'permission', 'key': 'permission', 'nameEn': 'Permission', 'nameAr': 'إذن'},
  'date': date.isEmpty ? '$y-10-20' : date,
  'startDate': date.isEmpty ? '$y-10-20' : date,
  'endDate': date.isEmpty ? '$y-10-20' : date,
  'hours': 2,
  'fromTime': '16:00',
  'toTime': '18:00',
  'reason': 'Doctor’s appointment',
  'status': status,
  'stage': null,
  'waitingForYou': false,
  'canCancel': false,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'recordedByHr': false,
  'steps': [stepJson('submitted'), stepJson('manager_decision', decision: 'approve', actor: 'Sara Ali'), stepJson('hr_decision', decision: 'approve', actor: 'Mona HR')],
  'monthLeft': 2,
  'createdAt': '$y-10-19T09:00:00.000Z',
  'confidential': false,
};

Map<String, Object?> correctionJson({String id = 'c1', String status = 'with_hr'}) => {
  'id': id,
  'kind': 'correction',
  'employee': employeeJson(),
  'date': '$y-10-21',
  'correctionKind': 'forgot_check_out',
  'checkIn': null,
  'checkOut': '$y-10-21T15:30:00.000Z',
  'reason': 'I left for a client meeting and forgot to check out.',
  'dayBefore': {'status': 'worked', 'checkIn': '$y-10-21T06:02:00.000Z', 'checkOut': null, 'place': 'office', 'source': 'system'},
  'status': status,
  'stage': 'hr',
  'waitingForYou': false,
  'canCancel': true,
  'confidential': false,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'recordedByHr': false,
  'appliedAt': null,
  'steps': [stepJson('submitted'), stepJson('manager_decision', decision: 'approve', actor: 'Sara Ali')],
  'createdAt': '$y-10-22T08:00:00.000Z',
};

Map<String, Object?> wfhJson({String id = 'w1', String status = 'rejected'}) => {
  'id': id,
  'kind': 'wfh',
  'employee': employeeJson(),
  'type': {'id': 'wfh', 'key': 'wfh', 'nameEn': 'Work from home', 'nameAr': 'العمل من المنزل'},
  'date': '$y-10-15',
  'startDate': '$y-10-15',
  'endDate': '$y-10-15',
  'reason': null,
  'status': status,
  'stage': null,
  'waitingForYou': false,
  'confidential': false,
  'canCancel': false,
  'hrCanCancel': false,
  'manager': approverJson(),
  'rejectedStage': 'manager',
  'rejectReason': 'We need you at the shoot that day.',
  'recordedByHr': false,
  'source': 'system',
  'warnings': <String>[],
  'steps': [stepJson('submitted'), stepJson('manager_decision', decision: 'reject', actor: 'Sara Ali', comment: 'We need you at the shoot that day.')],
  'monthUsed': 1,
  'createdAt': '$y-10-12T10:00:00.000Z',
};

Map<String, Object?> odJson({String id = 'o1', String status = 'approved'}) => {
  'id': id,
  'kind': 'od',
  'employee': employeeJson(),
  'type': {'id': 'od', 'key': 'od', 'nameEn': 'Official duty', 'nameAr': 'مأمورية'},
  'startDate': '$y-10-08',
  'endDate': '$y-10-08',
  'fullDay': false,
  'fromTime': '10:00',
  'toTime': '14:00',
  'dutyPlace': 'Client’s office, New Cairo',
  'reason': 'Launch shoot',
  'late': false,
  'status': status,
  'stage': null,
  'waitingForYou': false,
  'confidential': false,
  'canCancel': false,
  'hrCanCancel': true,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'steps': [stepJson('submitted'), stepJson('manager_decision', decision: 'approve', actor: 'Sara Ali'), stepJson('hr_decision', decision: 'approve', actor: 'Mona HR')],
  'createdAt': '$y-10-06T10:00:00.000Z',
  'compensation': null,
};

Map<String, Object?> compensatoryJson({String id = 'k1', String status = 'with_manager'}) => {
  'id': id,
  'kind': 'compensatory',
  'employee': employeeJson(),
  'type': {'id': 'compensatory', 'key': 'compensatory', 'nameEn': 'Compensatory day off', 'nameAr': 'يوم تعويضي'},
  'dayWorked': '$y-10-24',
  'dayOff': '$y-10-29',
  'startDate': '$y-10-29',
  'endDate': '$y-10-29',
  'reason': null,
  'status': status,
  'stage': 'manager',
  'outcome': null,
  'cashDays': 1.5,
  'hoursWorked': null,
  'hoursOff': null,
  'od': null,
  'noCheckIn': false,
  'waitingForYou': false,
  'confidential': false,
  'canCancel': true,
  'hrCanCancel': false,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'recordedByHr': false,
  'warnings': <String>[],
  'steps': [stepJson('submitted')],
  'createdAt': '$y-10-25T09:00:00.000Z',
};

Map<String, Object?> homeJson({String id = 'h1', String status = 'with_hr', String type = 'home'}) => {
  'id': id,
  'kind': 'home',
  'type': type,
  'forEveryone': type == 'client',
  'reason': 'I work from home on Thursdays.',
  'wishedEndDate': null,
  'validity': null,
  'validUntil': null,
  'endsOn': null,
  'inForce': false,
  'location': null,
  'overlaps': null,
  'employee': {...employeeJson(), 'workArrangement': 'hybrid', 'checkInAnywhere': false},
  'latitude': 30.0596,
  'longitude': 31.3462,
  'label': 'Home, Nasr City',
  'radiusMetres': 100,
  'accuracyMetres': 12,
  'status': status,
  'stage': 'hr',
  'waitingForYou': false,
  'confidential': false,
  'canWithdraw': status == 'with_hr' || status == 'with_ceo',
  'canRemove': status == 'approved' && type != 'client',
  'rejectedStage': null,
  'rejectReason': null,
  'approvedAt': null,
  'endedAt': null,
  'steps': [
    {'id': 's1', 'kind': 'submitted', 'decision': null, 'radiusMetres': 100, 'comment': null, 'actor': 'Hazem Soliman', 'at': '$y-10-23T10:00:00.000Z'},
  ],
  'createdAt': '$y-10-23T10:00:00.000Z',
};

Map<String, Object?> claimJson({String id = 'r1', String status = 'with_finance'}) => {
  'id': id,
  'employee': {'id': 'e1', 'fullNameEn': 'Hazem Soliman', 'fullNameAr': null, 'department': 'Production', 'team': 'Video'},
  'type': {'id': 'rt1', 'nameEn': 'Transport', 'nameAr': 'مواصلات', 'receiptRequired': true},
  'expenseDate': '$y-10-18',
  'amount': 250.5,
  'approvedAmount': 250.5,
  'description': 'Taxi to the client’s office for the launch meeting',
  'status': status,
  'stage': 'finance',
  'waitingForYou': false,
  'canCancel': true,
  'manager': approverJson(),
  'rejectedStage': null,
  'rejectReason': null,
  'payMonth': null,
  'payroll': null,
  'receipts': [
    {'id': 'rc1', 'fileName': 'receipt.jpg', 'mimeType': 'image/jpeg', 'sizeBytes': 245760},
  ],
  'steps': [
    {...stepJson('submitted'), 'amount': 250.5},
    {...stepJson('manager_decision', decision: 'approve', actor: 'Sara Ali'), 'amount': 250.5},
    {...stepJson('hr_decision', decision: 'approve', actor: 'Mona HR'), 'amount': 250.5},
  ],
  'createdAt': '$y-10-18T12:00:00.000Z',
  'confidential': false,
};

Map<String, Object?> resignationFormJson({bool offered = true, String? refusal}) => {
  'offered': offered,
  'refusal': refusal,
  'today': '$y-10-30',
  'notice': '3 months',
  'noticeAmount': 3,
  'noticeUnit': 'months',
  'lastDayIfToday': '${y + 1}-01-29',
};

Map<String, Object?> resignationJson({String id = 'x1', String status = 'sent'}) => {
  'id': id,
  'employee': {'id': 'e1', 'employeeCode': 'TL-014', 'fullNameEn': 'Hazem Soliman'},
  'employmentId': 'em1',
  'status': status,
  'statusLabel': {'sent': 'Sent', 'recorded': 'Recorded', 'withdrawn': 'Withdrawn', 'returned': 'Returned'}[status],
  'reason': 'Moving abroad.',
  'preferredLastDay': null,
  'sentOn': '$y-10-30',
  'notice': '3 months',
  'ruleLastDay': '${y + 1}-01-29',
  'letter': null,
  'withdrawnAt': null,
  'returned': null,
  'recorded': null,
  'createdAt': '$y-10-30T09:00:00.000Z',
  'mine': true,
  'confidential': false,
};

Map<String, Object?> balancesJson() => {
  'year': y,
  'annual': {'entitlement': 21, 'usableFrom': '$y-01-01', 'carriedIn': 0, 'adjustments': 0, 'taken': 2, 'booked': 0, 'pending': 0, 'available': 19},
  'types': [
    {'typeId': 't-casual', 'nameEn': 'Casual leave', 'nameAr': 'إجازة عارضة', 'used': 1, 'timesInService': 0, 'daysPerYear': 7, 'left': 6},
    {'typeId': 't-sick', 'nameEn': 'Sick leave', 'nameAr': 'إجازة مرضية', 'used': 0, 'timesInService': 0, 'left': null},
    {'typeId': 't-unpaid', 'nameEn': 'Unpaid leave', 'nameAr': 'إجازة بدون أجر', 'used': 0, 'timesInService': 0, 'left': null},
  ],
};

Map<String, Object?> leaveTypeJson(String key, String name, {String balance = 'none', bool document = false, bool halfDays = false, double? daysPerYear, int sort = 0, String? kind}) => {
  'id': 't-$key',
  'key': key,
  'kind': kind ?? key,
  'nameEn': name,
  'nameAr': 'إجازة',
  'paid': key == 'unpaid' ? 'unpaid' : 'paid',
  'payPercent': null,
  'balance': balance,
  'daysPerYear': daysPerYear,
  'maxPerRequest': null,
  'maxTimesInService': null,
  'minServiceMonths': null,
  'noticeDays': null,
  'documentRequired': document,
  'gender': null,
  'calendarDays': false,
  'halfDays': halfDays,
  'active': true,
  'sortOrder': sort,
};

List<Map<String, Object?>> leaveTypesJson() => [
  leaveTypeJson('annual', 'Annual leave', balance: 'annual', halfDays: true, sort: 1),
  leaveTypeJson('casual', 'Casual leave', balance: 'from_annual', halfDays: true, daysPerYear: 7, sort: 2),
  leaveTypeJson('sick', 'Sick leave', document: true, sort: 3),
  leaveTypeJson('unpaid', 'Unpaid leave', halfDays: true, sort: 4),
];

Map<String, Object?> coverageJson({bool required = false}) => {
  'group': {'id': 'g1', 'nameEn': 'Video', 'team': true},
  'limit': null,
  'limited': false,
  'viewer': 'requester',
  'days': <Object>[],
  'overLimit': false,
  'covering': <Object>[],
  'leaveDays': 3,
  'cover': {
    'required': required,
    'overDays': 2,
    'candidates': [
      {'id': 'c-omar', 'fullNameEn': 'Omar Adel', 'department': 'Production', 'team': 'Video', 'sameTeam': true},
      {'id': 'c-nour', 'fullNameEn': 'Nour Samir', 'department': 'Production', 'team': 'Photo', 'sameTeam': false},
    ],
  },
  'standIn': {'needed': false, 'default': null, 'options': <Object>[], 'hr': true, 'cLevel': false},
};

Map<String, Object?> permissionMonthJson({double left = 4}) => {
  'month': '$y-10',
  'hoursPerMonth': 4,
  'maxHoursPerDay': 2,
  'approved': 4 - left,
  'pending': 0,
  'left': left,
  'days': <Object>[],
};

Map<String, Object?> wfhAllowanceJson({bool offered = true}) => {
  'month': '$y-10',
  'daysPerMonth': 2,
  'minGapDays': 7,
  'used': 0,
  'approved': 0,
  'pending': 0,
  'taken': <Object>[],
  'nextPossible': '$y-11-02',
  'offered': offered,
  'refusal': null,
  'today': '$y-10-30',
};

Map<String, Object?> odFormJson() => {
  'today': '$y-10-30',
  'earliest': '$y-10-27',
  'shift': {'startTime': '09:00', 'endTime': '18:00', 'graceMinutes': 15},
  'refusal': null,
  'toCeo': false,
  'workingDays': [0, 1, 2, 3, 4],
  'holidays': <Object>[],
  'rules': {'cashRate': 1.5, 'minHours': 2, 'hoursCap': 4, 'fullDayHours': 6, 'offWithinDays': null},
  'hoursADay': 8,
  'compensated': <Object>[],
};

Map<String, Object?> compensatoryFormJson() => {
  'refusal': null,
  'offered': true,
  'hasShift': true,
  'today': '$y-10-30',
  'cashDays': 1.5,
  'rules': {'cashRate': 1.5, 'minHours': 2, 'hoursCap': 4, 'fullDayHours': 6, 'offWithinDays': null},
  'hoursADay': 8,
  'workingDays': [0, 1, 2, 3, 4],
  'holidays': <Object>[],
  'leave': <Object>[],
  'other': <Object>[],
  'claimed': <String>[],
  'checkedIn': ['$y-10-24'],
  'from': '$y-08-30',
  'to': '$y-12-31',
};

List<Map<String, Object?>> claimTypesJson() => [
  {
    'id': 'rt1',
    'nameEn': 'Transport',
    'nameAr': 'مواصلات',
    'description': 'Taxis and ride-hailing for work.',
    'receiptRequired': true,
    'capPerClaim': 500,
    'capPerMonth': 1000,
    'capPerYear': null,
    'claimWithinDays': 30,
    'active': true,
    'usedInMonth': 250.5,
    'usedInYear': 900,
  },
];

Map<String, Object?> profileJson({bool confidential = false}) => {
  'id': 'e1',
  'fullNameEn': 'Hazem Soliman',
  'confidential': confidential,
  'gender': 'male',
  'completeness': {'percent': 100, 'missing': <Object>[]},
  'employment': {
    'joinDate': '${y - 3}-02-01',
    'employmentType': 'full_time',
    'shift': {'workingDays': [0, 1, 2, 3, 4]},
  },
};

/// People answering everything the tab and its forms read: the person's requests of every kind and the forms.
FakePeople requestsPeople() {
  return FakePeople()
    ..on('GET /api/auth/me', (req) => json(meJson()))
    ..on('GET /api/me/attendance/today', (req) => json({'refusal': 'Not today.', 'date': '$y-10-30', 'now': '$y-10-30T07:00:00.000Z', 'next': 'in', 'punches': <Object>[]}))
    ..on('GET /api/employees/e1', (req) => json(profileJson()))
    ..on('GET /api/me/leave/balances', (req) => json(balancesJson()))
    ..on('GET /api/leave/types', (req) => json(leaveTypesJson()))
    ..on('GET /api/payroll/holidays', (req) => json(<Object>[]))
    ..on('GET /api/me/leave/requests', (req) => json([leaveJson(type: 'Casual leave', typeKey: 'casual', id: 'l2', status: 'approved', recordedByHr: true, canCancel: false, days: 1, start: '$y-10-26', end: '$y-10-26')]))
    ..on('GET /api/me/leave/coverage', (req) => json(coverageJson()))
    ..on('GET /api/me/permissions', (req) => json([permissionJson()]))
    ..on('GET /api/me/permissions/allowance', (req) => json(permissionMonthJson()))
    ..on('GET /api/me/attendance/corrections', (req) => json(<Object>[]))
    ..on('GET /api/me/wfh', (req) => json(<Object>[]))
    ..on('GET /api/me/wfh/allowance', (req) => json(wfhAllowanceJson()))
    ..on('GET /api/me/official-duty', (req) => json(<Object>[]))
    ..on('GET /api/me/official-duty/form', (req) => json(odFormJson()))
    ..on('GET /api/me/compensatory', (req) => json(<Object>[]))
    ..on('GET /api/me/compensatory/form', (req) => json(compensatoryFormJson()))
    ..on('GET /api/me/home-locations', (req) => json(<Object>[]))
    ..on('GET /api/me/reimbursements', (req) => json(<Object>[]))
    ..on('GET /api/me/reimbursement-types', (req) => json(claimTypesJson()))
    ..on('GET /api/me/resignation', (req) => json({'requests': <Object>[], 'form': resignationFormJson()}));
}

/// A photo the "camera" gives in the tests: a few bytes of a JPEG.
class FakePhotos implements PhotoSource {
  FakePhotos([this.name = 'photo.jpg']);

  final String name;
  var picked = 0;

  @override
  Future<PickedPhoto?> pick({required bool camera}) async {
    picked++;
    return PickedPhoto(name: name, bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70]));
  }
}

/// The app signed in, on the Requests tab.
Future<void> openRequestsTab(WidgetTester tester, FakePeople people, {PhotoSource? photos}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept')),
        photoSourceProvider.overrideWithValue(photos ?? FakePhotos()),
      ],
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.requests));
  await tester.pumpAndSettle();
}

/// A page with one button ("Open") that opens a sheet ([show], given the page's context), in the app's theme, over the
/// fakes: for a sheet's own tests. Once sent, the request's page opens on this page's navigator.
Future<void> openSheet(WidgetTester tester, FakePeople people, Future<void> Function(BuildContext context) show, {PhotoSource? photos, bool dark = false}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept')),
        photoSourceProvider.overrideWithValue(photos ?? FakePhotos()),
      ],
      child: MaterialApp(
        theme: appTheme(dark ? Brightness.dark : Brightness.light),
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(child: TextButton(onPressed: () => show(context), child: const Text('Open'))),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

/// Scrolls the tab (or the open sheet) until [finder] shows, then taps it.
Future<void> scrollAndTap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// The last request sent to a route.
http.Request lastSent(FakePeople people, String route) => people.sent.lastWhere((r) => '${r.method} ${r.url.path}' == route);

/// A body as text, a photo's bytes read as they come (not UTF-8).
String _text(http.Request r) => utf8.decode(r.bodyBytes, allowMalformed: true);

/// A multipart/form-data body's text fields (a file's part, "; filename=", isn't one).
Map<String, String> formFields(http.Request r) => {
  for (final m in RegExp(r'(?<=; )name="([^"]+)"\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--').allMatches(_text(r))) m[1]!: m[2]!,
};

/// A multipart/form-data body's files: each field's name with its file's name.
List<(String, String)> formFiles(http.Request r) => [for (final m in RegExp(r'name="([^"]+)"; filename="([^"]+)"').allMatches(_text(r))) (m[1]!, m[2]!)];

/// The text box of a sheet's field, by its label (SheetTextBox's key).
Finder textBox(String label) => find.byKey(ValueKey('text:$label'));

/// Types into the text box under a label.
Future<void> typeInto(WidgetTester tester, String label, String text) async {
  await tester.ensureVisible(textBox(label));
  await tester.enterText(textBox(label), text);
  await tester.pump();
}
