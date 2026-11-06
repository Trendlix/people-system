import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/requests/approvals.dart';
import 'package:people/features/requests/request_text.dart' show todayIso;
import 'package:people/features/timesheet/timesheet_logic.dart';
import 'package:people/features/timesheet/timesheet_screen.dart';
import 'package:people/features/timesheet/timesheet_week_page.dart';
import 'package:people/features/timesheet/timesheet_words.dart';
import 'package:people/models/timesheet.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'requests_fixtures.dart' show requestsPeople;

// Timesheets in the app (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Only those HR
// switches on"): the week's rules, My timesheet (a line added in its sheet, saved, sent), Log hours on the Dashboard and
// My timesheet in the menu only for those on timesheets, and a week approved from To approve.

Map<String, Object?> lineJson(String date, {String? client, String? task = 'Editing', double hours = 3}) => {
  'id': 'l-$date-$hours',
  'date': date,
  'client': client == null ? null : {'id': 'c1', 'name': client},
  'task': task,
  'hours': hours,
  'note': null,
};

Map<String, Object?> weekJson({String? status, List<Map<String, Object?>> lines = const [], bool edit = true, bool submit = false, String? refusal, List<String> unsent = const []}) {
  final start = weekOf(todayIso());
  final days = weekDays(start);
  return {
    'id': status == null ? null : 'w1',
    'employee': {'id': 'e1', 'fullNameEn': 'Hazem Soliman', 'employeeCode': 'TL-014'},
    'weekStart': start,
    'weekEnd': days.last,
    'status': status,
    'entries': lines,
    'totalHours': lines.fold<double>(0, (n, l) => n + (l['hours'] as double)),
    'days': [for (final d in days) {'date': d, 'hours': lines.where((l) => l['date'] == d).fold<double>(0, (n, l) => n + (l['hours'] as double))}],
    'submittedAt': null,
    'decidedAt': null,
    'decidedBy': null,
    'rejectReason': null,
    'approver': status == 'submitted' ? {'id': 'e9', 'fullNameEn': 'Mona Manager'} : null,
    'waitingForYou': false,
    'can': {'edit': edit, 'submit': submit, 'decide': false},
    'refusal': refusal,
    'clients': [
      {'id': 'c1', 'name': 'Acme', 'assigned': true},
      {'id': 'c2', 'name': 'Beta', 'assigned': false},
    ],
    'unsent': unsent,
  };
}

Future<void> openApp(WidgetTester tester, FakePeople people) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(retry: noRetry, overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')), child: const PeopleApp()),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('the week’s rules', () {
    test('runs Sunday to Saturday', () {
      expect(weekOf('2026-11-04'), '2026-11-01');
      expect(weekOf('2026-11-01'), '2026-11-01');
      expect(weekOf('2026-11-07'), '2026-11-01');
      expect(weekShift('2026-11-01', -1), '2026-10-25');
      expect(weekDays('2026-11-01'), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    });

    test('takes hours in quarter hours, 7.5 or 7:30', () {
      expect(hoursOf('7.5'), 7.5);
      expect(hoursOf('7:30'), 7.5);
      expect(hoursOf('1,25'), 1.25);
      expect(hoursOf('x'), isNull);
      expect(hoursOk(0.25), isTrue);
      expect(hoursOk(0.2), isFalse);
      expect(hoursOk(0), isFalse);
      expect(hoursOk(24.25), isFalse);
    });

    test('says what stops a line', () {
      expect(lineProblems(clientId: null, task: ' ', hours: 2, date: '2026-11-02', today: '2026-11-04', otherHoursThatDay: 0), [TimesheetWords.clientOrTask]);
      expect(lineProblems(clientId: 'c1', task: '', hours: 0.3, date: '2026-11-02', today: '2026-11-04', otherHoursThatDay: 0), [TimesheetWords.hoursRule]);
      expect(lineProblems(clientId: 'c1', task: '', hours: 5, date: '2026-11-02', today: '2026-11-04', otherHoursThatDay: 20), [TimesheetWords.dayFull('2026-11-02')]);
      expect(lineProblems(clientId: 'c1', task: '', hours: 5, date: '2026-11-05', today: '2026-11-04', otherHoursThatDay: 0), [TimesheetWords.futureDay]);
      expect(lineProblems(clientId: null, task: 'Editing', hours: 7.75, date: '2026-11-04', today: '2026-11-04', otherHoursThatDay: 0), isEmpty);
    });

    test('reads the week as People sends it', () {
      final t = MyTimesheet.fromJson(weekJson(status: 'rejected', lines: [lineJson(weekOf(todayIso()), client: 'Acme', task: null)], unsent: ['2026-10-25']));
      expect(t.status, TimesheetStatus.rejected);
      expect(t.lines.single.what, 'Acme');
      expect(t.lines.single.toJson(), {'date': weekOf(todayIso()), 'clientAccountId': 'c1', 'task': null, 'hours': 3.0, 'note': null});
      expect(t.clients.first.assigned, isTrue);
      expect(t.unsent, ['2026-10-25']);
      expect(t.refusal, isNull);
    });
  });

  group('My timesheet', () {
    late FakePeople people;

    setUp(() {
      people = requestsPeople()..on('GET /api/me/attendance/today', (req) => json({'refusal': 'You log your hours on your timesheet instead of checking in.', 'date': todayIso(), 'now': '${todayIso()}T07:00:00.000Z', 'next': 'in', 'punches': <Object>[]}));
    });

    testWidgets('offers Log hours on the Dashboard to those on timesheets, and adds, saves and sends a day’s hours', (tester) async {
      var current = weekJson();
      people
        ..on('GET /api/me/timesheet', (req) => json(current))
        ..on('PUT /api/me/timesheet', (req) {
          current = weekJson(status: 'draft', lines: [lineJson(todayIso(), client: 'Acme', task: 'Editing', hours: 7.5)], submit: true);
          return json(current);
        })
        ..on('POST /api/me/timesheet/submit', (req) {
          current = weekJson(status: 'submitted', lines: [lineJson(todayIso(), client: 'Acme', task: 'Editing', hours: 7.5)], edit: false);
          return json(current);
        });
      await openApp(tester, people);
      expect(find.text(TimesheetWords.logHoursLine), findsOneWidget);
      await tester.tap(find.text(TimesheetWords.logHours));
      await tester.pumpAndSettle();
      expect(find.byType(TimesheetScreen), findsOneWidget);

      // today's Add hours: the client theirs first, a task, the hours
      final today = todayIso();
      // today's own Add hours, by its date (the week's days below are built as they scroll into view)
      final add = find.byKey(ValueKey('add:$today'));
      await tester.scrollUntilVisible(add, 200, scrollable: find.descendant(of: find.byType(TimesheetScreen), matching: find.byType(Scrollable)).first);
      await tester.tap(add);
      await tester.pumpAndSettle();
      await tester.tap(find.text(TimesheetWords.noClient));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Acme · ${TimesheetWords.yours}').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('text:${TimesheetWords.task}')), 'Editing');
      await tester.enterText(find.byKey(const ValueKey('text:${TimesheetWords.hours}')), '7:30');
      await tester.tap(find.text(TimesheetWords.keep));
      await tester.pumpAndSettle();
      expect(find.text(TimesheetWords.unsaved), findsOneWidget);
      expect(find.text('Acme · Editing'), findsOneWidget);

      // sent: saved first, then sent
      await tester.scrollUntilVisible(find.text(TimesheetWords.send), 300, scrollable: find.descendant(of: find.byType(TimesheetScreen), matching: find.byType(Scrollable)).first);
      // clear of the floating tab bar
      await tester.ensureVisible(find.text(TimesheetWords.send));
      await tester.pumpAndSettle();
      await tester.tap(find.text(TimesheetWords.send));
      await tester.pumpAndSettle();
      expect(people.bodyOf('PUT /api/me/timesheet'), {
        'entries': [
          {'date': today, 'clientAccountId': 'c1', 'task': 'Editing', 'hours': 7.5, 'note': null},
        ],
      });
      expect(people.calls, contains('POST /api/me/timesheet/submit'));
      expect(find.text(TimesheetWords.sent), findsOneWidget);
    });

    testWidgets('a line needs a client or a task, in quarter hours', (tester) async {
      people.on('GET /api/me/timesheet', (req) => json(weekJson()));
      await openApp(tester, people);
      await tester.tap(find.text(TimesheetWords.logHours));
      await tester.pumpAndSettle();
      final add = find.byKey(ValueKey('add:${todayIso()}'));
      await tester.scrollUntilVisible(add, 200, scrollable: find.descendant(of: find.byType(TimesheetScreen), matching: find.byType(Scrollable)).first);
      await tester.tap(add);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('text:${TimesheetWords.hours}')), '1.1');
      await tester.tap(find.text(TimesheetWords.keep));
      await tester.pumpAndSettle();
      expect(find.text(TimesheetWords.clientOrTask), findsOneWidget);
      expect(find.text(TimesheetWords.hoursRule), findsOneWidget);
    });

    testWidgets('shows neither Log hours nor My timesheet to those who check in', (tester) async {
      people.on('GET /api/me/timesheet', (req) => json(weekJson(refusal: 'You check in and out instead of logging hours on a timesheet.')));
      await openApp(tester, people);
      expect(find.text(TimesheetWords.logHours), findsNothing);
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      expect(find.text(TimesheetWords.menu), findsNothing);
    });

    testWidgets('lists My timesheet in the menu for those on timesheets', (tester) async {
      people.on('GET /api/me/timesheet', (req) => json(weekJson()));
      await openApp(tester, people);
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      expect(find.text(TimesheetWords.menu), findsOneWidget);
    });
  });

  group('approving a week', () {
    late FakePeople people;

    setUp(() => people = requestsPeople());

    testWidgets('lists it in To approve, approves it in one tap, opens it', (tester) async {
      final start = weekOf(todayIso());
      var waiting = [
        {'id': 'w9', 'employee': {'id': 'e5', 'fullNameEn': 'Omar Staff', 'employeeCode': null}, 'weekStart': start, 'weekEnd': weekDays(start).last, 'status': 'submitted', 'totalHours': 32.5, 'submittedAt': null, 'waitingForYou': true},
      ];
      people
        ..on('GET /api/timesheets', (req) => json(waiting))
        ..on('GET /api/timesheets/w9', (req) => json({...weekJson(status: 'submitted', lines: [lineJson(start, task: 'Shoot', hours: 8)], edit: false), 'id': 'w9', 'employee': {'id': 'e5', 'fullNameEn': 'Omar Staff', 'employeeCode': null}, 'waitingForYou': true, 'can': {'edit': false, 'submit': false, 'decide': true}}))
        ..on('POST /api/timesheets/w9/decide', (req) {
          waiting = [];
          return json({...weekJson(status: 'approved', edit: false), 'id': 'w9'});
        });
      await openRequestsTabHere(tester, people);
      expect(find.text(ApproveWords.weekLine(start, weekDays(start).last, 32.5)), findsOneWidget);

      // its page: whose week, its lines, the decision
      await tester.tap(find.text('Omar Staff'));
      await tester.pumpAndSettle();
      expect(find.byType(TimesheetWeekPage), findsOneWidget);
      expect(find.text(TimesheetWords.weekOf('Omar Staff')), findsOneWidget);
      expect(find.text('Shoot'), findsOneWidget);
      await tester.scrollUntilVisible(find.text(ApproveWords.decideTitle), 300, scrollable: find.descendant(of: find.byType(TimesheetWeekPage), matching: find.byType(Scrollable)).first);
      await tester.tap(find.widgetWithText(FilledButton, ApproveWords.approve));
      await tester.pumpAndSettle();
      expect(people.bodyOf('POST /api/timesheets/w9/decide'), {'decision': 'approve'});
    });

    testWidgets('rejects a week only with why', (tester) async {
      final start = weekOf(todayIso());
      people
        ..on('GET /api/timesheets', (req) => json([
              {'id': 'w9', 'employee': {'id': 'e5', 'fullNameEn': 'Omar Staff', 'employeeCode': null}, 'weekStart': start, 'weekEnd': weekDays(start).last, 'status': 'submitted', 'totalHours': 8, 'submittedAt': null, 'waitingForYou': true},
            ]))
        ..on('POST /api/timesheets/w9/decide', (req) => json({...weekJson(status: 'rejected', edit: false), 'id': 'w9'}));
      await openRequestsTabHere(tester, people);
      await tester.tap(find.byTooltip(ApproveWords.reject));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Thursday is missing');
      await tester.tap(find.widgetWithText(FilledButton, ApproveWords.reject));
      await tester.pumpAndSettle();
      expect(people.bodyOf('POST /api/timesheets/w9/decide'), {'decision': 'reject', 'comment': 'Thursday is missing'});
    });
  });
}

/// The app opened on its Requests tab.
Future<void> openRequestsTabHere(WidgetTester tester, FakePeople people) async {
  await openApp(tester, people);
  await tester.tap(find.text(ShellWords.requests));
  await tester.pumpAndSettle();
}
