import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/attendance/attendance_data.dart';
import 'package:people/features/attendance/attendance_tab.dart';
import 'package:people/features/attendance/attendance_words.dart';
import 'package:people/features/attendance/my_corrections_screen.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'attendance_models_test.dart' show correctionJson, octoberJson;
import 'dashboard_test.dart' show punchJson, todayJson;
import 'fakes.dart';

// The Attendance tab in the phone design (30 October 2026): today with the one button, the month switched, the
// calendar by week and by month, the figures, every day and its details, My corrections (and cancelling one), and
// asking for a correction, sending what People takes and showing People's refusal in its words.

Future<void> openAttendance(WidgetTester tester, FakePeople people) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept')),
        attendanceClockProvider.overrideWithValue(() => DateTime(2026, 10, 30, 14)),
      ],
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.attendance));
  await tester.pumpAndSettle();
}

/// The tab's own list (the other tabs' stay in the tree, offstage).
Finder get tabList => find.descendant(of: find.byType(AttendanceTab), matching: find.byType(Scrollable)).first;

/// Scrolls [target], already built, to the middle of the screen.
Future<void> centre(WidgetTester tester, Finder target) async {
  unawaited(Scrollable.ensureVisible(tester.element(target), alignment: 0.5));
  await tester.pumpAndSettle();
}

/// Scrolls the tab until [target] is in the middle of the screen (clear of the header and the floating tab bar).
Future<void> reach(WidgetTester tester, Finder target) async {
  await tester.scrollUntilVisible(target, 300, scrollable: tabList);
  unawaited(Scrollable.ensureVisible(tester.element(target), alignment: 0.5));
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;
  late List<String> monthsAsked;

  setUp(() {
    monthsAsked = [];
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({...todayJson(), 'expectedText': 'You work at the office: check in there.'}))
      ..on('GET /api/attendance/me', (req) {
        final month = req.url.queryParameters['month']!;
        monthsAsked.add(month);
        if (month == '2026-10') return json(octoberJson());
        return json({
          'month': month,
          'person': {'hoursADay': 9, 'figures': <String, Object>{}, 'days': <Object>[]},
          'corrections': <Object>[],
          'correctable': {'allowed': true, 'reason': null},
          'punches': <Object>[],
        });
      })
      ..on('GET /api/me/attendance/corrections', (req) => json([correctionJson()]));
  });

  testWidgets('shows today, this month’s week, its figures and every day, with no attendance rate', (tester) async {
    await openAttendance(tester, people);
    expect(find.text(AttendanceWords.title), findsOneWidget);
    expect(find.text(AttendanceWords.readyToStart), findsOneWidget);
    expect(find.text(AttendanceWords.notCheckedIn), findsOneWidget);
    expect(find.text('You work at the office: check in there. ${CheckInWords.privacy}'), findsOneWidget);
    expect(find.text(CheckInWords.checkIn), findsOneWidget);
    expect(find.text('October 2026'), findsWidgets);
    expect(monthsAsked, contains('2026-10'));

    await reach(tester, find.text('Week 5'));
    expect(find.text('25–31 October'), findsOneWidget);
    expect(find.bySemanticsLabel('Tue 27 October 2026, Worked'), findsOneWidget);
    expect(find.bySemanticsLabel('Sun 25 October 2026, On leave'), findsOneWidget);

    await reach(tester, find.text('141:56'));
    expect(find.text('8:52 daily average'), findsOneWidget);
    expect(find.textContaining(RegExp('rate', caseSensitive: false)), findsNothing);

    await reach(tester, find.text('Thu 01'));
    expect(find.text(AttendanceWords.yourDays), findsOneWidget);
    expect(find.text(AttendanceWords.myCorrections), findsOneWidget);
    expect(find.text(AttendanceWords.askCorrection), findsOneWidget);
  });

  testWidgets('switches to the month before and back, and shows the calendar by month', (tester) async {
    await openAttendance(tester, people);
    await tester.tap(find.byTooltip(AttendanceWords.showMonth('September 2026')));
    await tester.pumpAndSettle();
    expect(monthsAsked, contains('2026-09'));
    expect(find.text('September 2026'), findsWidgets);
    await reach(tester, find.text(AttendanceWords.notYet('September 2026')));
    expect(find.text(AttendanceWords.notYet('September 2026')), findsOneWidget);

    await tester.drag(tabList, const Offset(0, 3000));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip(AttendanceWords.showMonth('October 2026')));
    await tester.pumpAndSettle();
    await reach(tester, find.text(AttendanceWords.month));
    await tester.tap(find.text(AttendanceWords.month));
    await tester.pumpAndSettle();
    expect(find.text('Week 5'), findsNothing);
    expect(find.bySemanticsLabel('Thu 1 October 2026, Worked'), findsOneWidget);
    expect(find.bySemanticsLabel('Thu 8 October 2026, Official holiday'), findsOneWidget);
  });

  testWidgets('opens a day’s details: its pairs, break, balance and where it came from', (tester) async {
    await openAttendance(tester, people);
    await reach(tester, find.text('Mon 12'));
    await tester.tap(find.text('Mon 12'));
    await tester.pumpAndSettle();
    expect(find.text('Monday 12/10/2026'), findsOneWidget);
    expect(find.text('Break 50 min'), findsOneWidget);
    expect(find.text('+0:11 extra'), findsWidgets);
    expect(find.text(AttendanceWords.extraTitle), findsOneWidget);
    expect(find.text('Checked in on the system'), findsOneWidget);
    expect(find.text('Office · Head office'), findsWidgets);
    expect(find.text(AttendanceWords.askCorrection), findsWidgets);
  });

  testWidgets('a day with a correction being decided says so, and a corrected day what it was', (tester) async {
    await openAttendance(tester, people);
    await reach(tester, find.text('Mon 26'));
    await tester.tap(find.text('Mon 26'));
    await tester.pumpAndSettle();
    expect(find.text('Correction with the manager'), findsWidgets);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();

    await reach(tester, find.text('Tue 13'));
    await tester.tap(find.text('Tue 13'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Corrected from '), findsOneWidget);
  });

  testWidgets('asks for a correction from a day, sending the body People takes', (tester) async {
    people.on('POST /api/me/attendance/corrections', (req) => json({...correctionJson(id: 'c9'), 'date': '2026-10-27', 'correctionKind': 'worked_remotely'}, 201));
    await openAttendance(tester, people);
    await reach(tester, find.text('Tue 27'));
    await tester.tap(find.text('Tue 27'));
    await tester.pumpAndSettle();
    // the day's sheet's own (the card's is under it)
    await tester.tap(find.widgetWithText(FilledButton, AttendanceWords.askCorrection).last);
    await tester.pumpAndSettle();

    expect(find.text('Tuesday 27/10/2026'), findsOneWidget);
    expect(find.textContaining(AttendanceWords.needKind), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, AttendanceWords.send)).onPressed, isNull);

    await tester.tap(find.text(AttendanceWords.kinds['worked_remotely']!));
    await tester.pumpAndSettle();
    expect(find.textContaining(AttendanceWords.optional), findsWidgets);
    await tester.enterText(find.byType(TextField), 'At the client’s studio all day.');
    await tester.pumpAndSettle();
    expect(find.text(AttendanceWords.ready('worked_remotely', 'Tuesday 27/10/2026')), findsOneWidget);

    await centre(tester, find.text(AttendanceWords.send));
    await tester.tap(find.text(AttendanceWords.send));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/corrections'), {'date': '2026-10-27', 'kind': 'worked_remotely', 'reason': 'At the client’s studio all day.'});
    expect(find.text(AttendanceWords.sent('with_manager', managerRole: 'team_lead')), findsOneWidget);
    // the month read again with it
    expect(monthsAsked.where((m) => m == '2026-10').length, greaterThan(1));
  });

  testWidgets('shows People’s refusal in its words, the form kept', (tester) async {
    const refusal = 'The October 2026 payroll is approved, so its days can’t be corrected any more.';
    people.on('POST /api/me/attendance/corrections', (req) => json({'message': [refusal]}, 400));
    await openAttendance(tester, people);
    await reach(tester, find.text(AttendanceWords.askCorrection));
    await tester.tap(find.widgetWithText(FilledButton, AttendanceWords.askCorrection));
    await tester.pumpAndSettle();
    // the day from the picker
    await tester.tap(find.text(AttendanceWords.chooseDay));
    await tester.pumpAndSettle();
    await tester.tap(find.text('22'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('Thursday 22/10/2026'), findsOneWidget);
    await tester.tap(find.text(AttendanceWords.kinds['worked_remotely']!));
    await tester.enterText(find.byType(TextField), 'Client visit.');
    await tester.pumpAndSettle();
    await centre(tester, find.text(AttendanceWords.send));
    await tester.tap(find.text(AttendanceWords.send));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/corrections')['date'], '2026-10-22');
    expect(find.text(refusal), findsOneWidget);
    expect(find.text(AttendanceWords.send), findsOneWidget);
  });

  testWidgets('a month whose payroll is approved says why, and offers no correction', (tester) async {
    people.on('GET /api/attendance/me', (req) => json(octoberJson(correctable: false)));
    await openAttendance(tester, people);
    await reach(tester, find.text(AttendanceWords.myCorrections));
    expect(find.text('The October 2026 payroll is approved, so its days can’t be corrected any more.'), findsOneWidget);
    expect(find.text(AttendanceWords.askCorrection), findsNothing);
  });

  testWidgets('My corrections lists each with its steps, and cancels one', (tester) async {
    var cancelled = false;
    people
      ..on('GET /api/me/attendance/corrections', (req) => json([correctionJson(status: cancelled ? 'cancelled' : 'with_manager', canCancel: !cancelled)]))
      ..on('POST /api/me/attendance/corrections/c2/cancel', (req) {
        cancelled = true;
        return json(correctionJson(status: 'cancelled', canCancel: false));
      });
    await openAttendance(tester, people);
    await reach(tester, find.text(AttendanceWords.myCorrections));
    await tester.tap(find.text(AttendanceWords.myCorrections));
    await tester.pumpAndSettle();
    expect(find.text('Wrong time'), findsOneWidget);
    expect(find.text('With the team lead (Sara Ali)'), findsOneWidget);
    expect(find.text('Asked for by the employee'), findsOneWidget);

    await centre(tester, find.text(AttendanceWords.cancelTitle));
    await tester.tap(find.text(AttendanceWords.cancelTitle));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AttendanceWords.cancelIt));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/me/attendance/corrections/c2/cancel'));
    expect(find.text(AttendanceWords.cancelled), findsOneWidget);
    expect(find.text(AttendanceWords.cancelTitle), findsNothing);

    await tester.drag(find.descendant(of: find.byType(MyCorrectionsScreen), matching: find.byType(Scrollable)).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip(AttendanceWords.back));
    await tester.pumpAndSettle();
    expect(find.byType(MyCorrectionsScreen), findsNothing);
    expect(find.text(AttendanceWords.yourDays), findsOneWidget);
  });

  testWidgets('checked in: the time worked, today’s check-ins, and Check out sends the press', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(todayJson(next: 'out', punches: [punchJson('in', '2026-10-30T06:58:00.000Z')])))
      ..on('POST /api/me/attendance/punches', (req) => json({...todayJson(), 'messages': <String>[], 'kept': true}));
    await openAttendance(tester, people);
    expect(find.text(AttendanceWords.timeWorked), findsOneWidget);
    expect(find.text(AttendanceWords.inOffice), findsOneWidget);
    expect(find.textContaining('Checked in at '), findsOneWidget);
    expect(find.text(AttendanceWords.todaysCheckIns), findsOneWidget);

    await reach(tester, find.text(CheckInWords.checkOut));
    await tester.tap(find.text(CheckInWords.checkOut));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches')['kind'], 'out');
  });

  testWidgets('an account on hold sees today only', (tester) async {
    people.on('GET /api/auth/me', (req) => json(meJson(hold: true)));
    await openAttendance(tester, people);
    await reach(tester, find.text(AttendanceWords.hold));
    expect(find.text(AttendanceWords.hold), findsOneWidget);
    expect(monthsAsked, isEmpty);
    expect(find.text(AttendanceWords.yourDays), findsNothing);
  });
}
