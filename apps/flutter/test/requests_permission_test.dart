import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/permission.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/request_forms.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// Permission in a few taps (README Phase 2): today, the most the day allows, a reason; the month's hours shown; People's
// rules checked as it checks them, its refusals in its words; the request's page with every step and Cancel.

Future<void> openPage(WidgetTester tester, FakePeople people, Map<String, Object?> json) => openSheet(
  tester,
  people,
  (context) async => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => RequestPage(kind: RequestKind.permission, id: '${json['id']}', initial: requestOf(RequestKind.permission, json)),
    ),
  ),
);

/// The day the sheet starts on: today, or the next working day of the fixtures' shift (Sunday to Thursday).
String firstDay() => nextWorkingDay(todayIso(), const [0, 1, 2, 3, 4], const {});

void main() {
  test('reads a permission and a month of permission hours by hand', () {
    final p = PermissionRequest.fromJson(permissionJson());
    expect(p.date, '$y-10-20');
    expect(p.hours, 2);
    expect((p.fromTime, p.toTime), ('16:00', '18:00'));
    expect(p.monthLeft, 2);
    expect(p.steps.map((s) => s.kind), ['submitted', 'manager_decision', 'hr_decision']);
    final m = PermissionMonth.fromJson({...permissionMonthJson(left: 2.5), 'pending': 0.5, 'days': [{'date': '$y-10-20', 'hours': 1.5}]});
    expect((m.hoursPerMonth, m.maxHoursPerDay, m.left), (4, 2, 2.5));
    expect(m.usedOn('$y-10-20'), 1.5);
    expect(permissionMonthText(m, '$y-10'), 'This month: 1:30 approved, 0:30 waiting, 2:30 left of 4:00');
    expect(permissionMonthText(m, '$y-11'), 'October $y: 1:30 approved, 0:30 waiting, 2:30 left of 4:00');
  });

  test('starts from the most the day and the month allow, in half hours', () {
    expect(defaultPermissionHours(PermissionMonth.fromJson(permissionMonthJson())), 2);
    expect(defaultPermissionHours(PermissionMonth.fromJson(permissionMonthJson(left: 1.5))), 1.5);
    expect(defaultPermissionHours(PermissionMonth.fromJson(permissionMonthJson(left: 0))), 0.5);
    expect(permissionTimesShown('17:00', null, 2), '5:00 PM – 7:00 PM');
    expect(permissionTimesShown(null, '10:00', 1.5), '8:30 AM – 10:00 AM');
    expect(permissionTimesShown(null, null, 2), isNull);
  });

  test('checks the day’s and the month’s hours and the times as People does', () {
    final m = PermissionMonth.fromJson({...permissionMonthJson(left: 1), 'days': [{'date': '$y-10-20', 'hours': 1.5}]});
    final day = dayWords('$y-10-20');
    expect(permissionProblems(date: '$y-10-20', hours: 1, m: m), [
      'Only 30 minutes left of the 2 hours a day on $day: 1 hour 30 minutes already asked for.',
    ]);
    expect(permissionProblems(date: '$y-10-21', hours: 1.5, m: m), ['Only 1 hour left of October $y\'s 4 hours of permission.']);
    expect(permissionProblems(date: '$y-10-21', hours: 1, m: m, from: '17:00', to: '19:00'), ['From 5:00 PM to 7:00 PM is 2 hours, not 1 hour: change the hours or the times.']);
    expect(permissionProblems(date: '$y-10-21', hours: 1, m: m, from: '18:00', to: '17:00'), [PermissionWords.endAfterStart]);
    expect(permissionProblems(date: '$y-10-21', hours: 1, m: m, from: '23:30'), ['1 hour from 11:30 PM run to midnight or past it: choose an earlier time.']);
    expect(permissionProblems(date: '$y-10-21', hours: 1, m: m, from: '17:00'), isEmpty);
    expect(permissionProblems(date: '$y-10-21', hours: 1, m: PermissionMonth.fromJson({...permissionMonthJson(), 'hoursPerMonth': 0})), [PermissionWords.turnedOff]);
  });

  testWidgets('asks for permission in a few taps: today, the most the day allows, a reason', (tester) async {
    final people = requestsPeople()..on('POST /api/me/permissions', (req) => json({...permissionJson(id: 'p9', status: 'with_manager', date: firstDay()), 'canCancel': true}, 201));
    await openSheet(tester, people, showPermissionSheet);
    expect(find.text(PermissionWords.title), findsOneWidget);
    expect(find.text('This month: 0:00 approved, 4:00 left of 4:00'), findsOneWidget);
    expect(find.text('Your permission: at most 2 hours a day and 4 hours a month, as Leave Setup gives it.'), findsOneWidget);
    expect(find.textContaining('Ready to send: 2 hours on ${dayWords(firstDay())}'), findsOneWidget);

    await scrollAndTap(tester, find.text('1 hour 30 minutes'));
    await typeInto(tester, PermissionWords.reason, 'Doctor’s appointment');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/permissions'), {'date': firstDay(), 'hours': 1.5, 'reason': 'Doctor’s appointment'});

    // the request's page opens, saying where it goes
    expect(find.text('Request sent. It goes to your direct manager, then HR; each step shows on the request.'), findsOneWidget);
    expect(find.text(PermissionWords.pageTitle), findsOneWidget);
  });

  testWidgets('holds the send while the month’s hours are all asked for', (tester) async {
    final people = requestsPeople()..on('GET /api/me/permissions/allowance', (req) => json(permissionMonthJson(left: 0)));
    await openSheet(tester, people, showPermissionSheet);
    expect(find.text(RequestsWords.beforeYouSend), findsOneWidget);
    expect(find.textContaining('of permission are already asked for.'), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.calls, isNot(contains('POST /api/me/permissions')));
  });

  testWidgets('says so when Leave Setup gives no permission hours', (tester) async {
    final people = requestsPeople()..on('GET /api/me/permissions/allowance', (req) => json({...permissionMonthJson(), 'hoursPerMonth': 0, 'left': 0}));
    await openSheet(tester, people, showPermissionSheet);
    expect(find.text(PermissionWords.off), findsOneWidget);
    expect(find.text(RequestsWords.send), findsNothing);
  });

  testWidgets('shows People’s refusal in its words, its dates as the website shows them', (tester) async {
    final people = requestsPeople()
      ..on('POST /api/me/permissions', (req) => json({'message': ['$y-10-30 is a rest day of your shift: there is no work to ask permission from.'], 'statusCode': 400}, 400));
    await openSheet(tester, people, showPermissionSheet);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(find.text('30/10/$y is a rest day of your shift: there is no work to ask permission from.'), findsOneWidget);
    expect(find.text(PermissionWords.title), findsOneWidget);
  });

  testWidgets('its page: the day, the hours, the times, every step, and Cancel', (tester) async {
    final p = {...permissionJson(status: 'with_hr'), 'canCancel': true};
    final people = requestsPeople()
      ..on(
        'POST /api/me/permissions/p1/cancel',
        (req) => json({
          ...p,
          'status': 'cancelled',
          'canCancel': false,
          'steps': [...p['steps']! as List, stepJson('cancelled')],
        }),
      );
    await openPage(tester, people, p);
    expect(find.text(dayWords('$y-10-20')), findsOneWidget);
    expect(find.text('2 hours'), findsOneWidget);
    expect(find.text('4:00 PM – 6:00 PM'), findsOneWidget);
    expect(find.text('2:00'), findsOneWidget);
    expect(find.text('Waiting for HR'), findsOneWidget);
    expect(find.text('Sara Ali'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('The direct manager approved it'), 200, scrollable: find.byType(Scrollable).last);

    await scrollAndTap(tester, find.text(PermissionWords.cancelButton));
    expect(find.text(PermissionWords.cancelConfirm(dayWords('$y-10-20'), '2 hours')), findsOneWidget);
    await tester.tap(find.text(PermissionWords.cancelButton).last);
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/me/permissions/p1/cancel'));
    await tester.scrollUntilVisible(find.text(PermissionWords.cancelled), -200, scrollable: find.byType(Scrollable).last);
    await tester.scrollUntilVisible(find.text(PermissionWords.stepCancelled), 200, scrollable: find.byType(Scrollable).last);
    expect(find.text(PermissionWords.cancelButton), findsNothing);
  });
}
