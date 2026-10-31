import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/correction.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/attendance_month.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// An attendance correction in a few taps (README Phase 2): the day with a check-in and no check-out chosen already, what
// is on record for it, "I forgot to check out" and the shift's end offered; the day's rules checked as People checks
// them, its refusals in its words; the correction's page with every step and Cancel.

final today = todayIso();
final yesterday = addDays(today, -1);

/// Yesterday is in this month: the sheet suggests it (on the 1st of a month there is no day gone by to suggest).
final sameMonth = yesterday.substring(0, 7) == today.substring(0, 7);

Map<String, Object?> dayJson(String date, {String status = 'worked', String? checkIn, String? checkOut, String? openAt}) => {
  'date': date,
  'status': status,
  'checkIn': checkIn,
  'checkOut': checkOut,
  'place': 'office',
  'source': 'system',
  'flags': <String>[],
  'pairs': null,
  'openAt': openAt,
  'hoursCounted': 0,
};

Map<String, Object?> monthJson({List<Map<String, Object?>>? days, bool allowed = true, List<Map<String, Object?>> corrections = const []}) => {
  'month': today.substring(0, 7),
  'self': true,
  'person': {
    'hoursADay': 8,
    'figures': <String, Object?>{},
    'days':
        days ??
        [
          if (sameMonth) dayJson(yesterday, checkIn: '${yesterday}T06:02:00.000Z', openAt: '${yesterday}T06:02:00.000Z'),
        ],
  },
  'correctable': {'allowed': allowed, 'reason': allowed ? null : 'The October $y payroll is approved, so its days can’t be corrected any more.'},
  'corrections': corrections,
};

Map<String, Object?> todayWithShift() => {
  'refusal': null,
  'date': today,
  'now': '${today}T07:00:00.000Z',
  'next': 'in',
  'punches': <Object>[],
  'shift': {'startTime': '09:00', 'endTime': '18:00', 'hoursPerDay': 8, 'graceMinutes': 15},
};

FakePeople correctionPeople({Map<String, Object?>? month}) => requestsPeople()
  ..on('GET /api/attendance/me', (req) => json(month ?? monthJson()))
  ..on('GET /api/me/attendance/today', (req) => json(todayWithShift()));

AttendanceDay day(String date, {String status = 'worked', String? checkIn, String? checkOut, String? openAt}) =>
    AttendanceDay.fromJson(dayJson(date, status: status, checkIn: checkIn, checkOut: checkOut, openAt: openAt));

void main() {
  test('reads a correction by hand', () {
    final c = CorrectionRequest.fromJson(correctionJson());
    expect((c.date, c.correctionKind, c.status, c.canCancel), ('$y-10-21', 'forgot_check_out', 'with_hr', true));
    expect(c.checkIn, isNull);
    expect(c.checkOut, '$y-10-21T15:30:00.000Z');
    expect(c.dayBefore?.status, 'worked');
    expect(c.dayBefore?.checkOut, isNull);
    expect(c.dayBefore?.source, 'system');
    expect(rightTimesText(c), startsWith('Out at '));
  });

  test('suggests the latest day gone by with a check-in and no check-out, and what was wrong', () {
    final m = AttendanceMonth.fromJson(
      monthJson(
        days: [
          dayJson('$y-10-05', checkIn: '$y-10-05T06:00:00.000Z'),
          dayJson('$y-10-12', status: 'no_check_in'),
          dayJson('$y-10-19', checkIn: '$y-10-19T06:00:00.000Z', checkOut: '$y-10-19T15:00:00.000Z'),
          dayJson('$y-10-30', checkIn: '$y-10-30T06:00:00.000Z'),
        ],
        corrections: [
          {'id': 'c1', 'date': '$y-10-12', 'correctionKind': 'forgot_check_in', 'status': 'with_manager', 'checkIn': null, 'checkOut': null},
        ],
      ),
    );
    // the 12th is asked already, the 19th is whole, the 30th is today
    expect(suggestedCorrectionDay(m, '$y-10-30'), '$y-10-05');
    expect(suggestedCorrectionDay(null, '$y-10-30'), '$y-10-30');
    expect(openCorrectionDays(m), {'$y-10-12'});
    expect(suggestedCorrectionKind(m.days[0], '$y-10-30'), 'forgot_check_out');
    expect(suggestedCorrectionKind(m.days[1], '$y-10-30'), 'forgot_check_in');
    expect(suggestedCorrectionKind(m.days[2], '$y-10-30'), 'wrong_time');
    expect(suggestedCorrectionKind(null, '$y-10-30'), 'forgot_check_in');
    expect(timesNeeded('forgot_check_out', null), (checkIn: TimeNeed.none, checkOut: TimeNeed.required));
    // work away from the office is official duty now (owner, 31 October 2026): not a kind to choose
    expect(CorrectionWords.kindLabels.keys, ['forgot_check_in', 'forgot_check_out', 'wrong_time']);
    // the day suggested is one still open to ask about (owner, 31 October 2026: "locked after 2 working days")
    expect(suggestedCorrectionDay(m, '$y-10-30', askFrom: '$y-10-28'), '$y-10-30');
  });

  test('checks the day, the reason and the times as People does', () {
    List<String> check(String kind, {String date = '', AttendanceDay? d, String? checkIn, String? checkOut, String reason = 'Why', String? now, Set<String> open = const {}}) =>
        correctionProblems(
          date: date.isEmpty ? '$y-10-21' : date,
          today: '$y-10-30',
          kind: kind,
          day: d,
          dayKnown: true,
          checkIn: checkIn,
          checkOut: checkOut,
          reason: reason,
          openDays: open,
          now: now,
        );
    final when = dayWords('$y-10-21');
    expect(check('forgot_check_in', date: '$y-11-02', checkIn: '09:00'), ['02/11/$y is still to come: only a day gone by, or today, can be corrected.']);
    expect(check('forgot_check_out', checkOut: '18:00', reason: ' '), [CorrectionWords.reasonMissing]);
    expect(check('forgot_check_out', checkOut: '18:00', open: {'$y-10-21'}), ['You asked to correct $when already: wait for it to be decided, or cancel it.']);
    expect(check('forgot_check_out', checkOut: '18:00', d: day('$y-10-21', status: 'leave')), ['You have approved leave on $when: there is no attendance to correct on a day of leave.']);
    expect(check('forgot_check_in'), [CorrectionWords.enterCameIn]);
    expect(check('forgot_check_out'), [CorrectionWords.enterLeft]);
    expect(check('wrong_time', d: day('$y-10-21')), [CorrectionWords.enterEither, 'There is no check-in or check-out on $when to correct: choose “I forgot to check in”.']);
    expect(check('wrong_time', checkIn: '18:00', checkOut: '09:00'), ['The check-out (9:00 AM) must be after the check-in (6:00 PM) on the same day.']);
    expect(check('forgot_check_out', date: '$y-10-30', checkOut: '18:00', now: '12:00'), ['Choose a time that has passed: 6:00 PM today hasn’t come yet.']);
    expect(check('forgot_check_out', checkOut: '18:00', d: day('$y-10-21', checkIn: '$y-10-21T06:00:00.000Z', openAt: '$y-10-21T06:00:00.000Z')), isEmpty);
    // too long after the day (owner, 31 October 2026: "locked after 2 working days")
    expect(
      correctionProblems(date: '$y-10-21', today: '$y-10-30', kind: 'forgot_check_out', day: null, dayKnown: false, checkIn: null, checkOut: '18:00', reason: 'Why', askFrom: '$y-10-28'),
      [CorrectionWords.tooLate(dmy('$y-10-21'))],
    );
  });

  testWidgets('asks to correct the day with no check-out in a few taps: the shift’s end offered', (tester) async {
    final people = correctionPeople()
      ..on('POST /api/me/attendance/corrections', (req) => json({...correctionJson(id: 'c9', status: 'with_manager'), 'date': yesterday}, 201));
    await openSheet(tester, people, showCorrectionSheet);
    expect(find.text(CorrectionWords.title), findsOneWidget);
    expect(find.text(CorrectionWords.onRecordFor(dayWords(yesterday))), findsOneWidget);
    expect(find.textContaining('– no check-out'), findsOneWidget);
    expect(find.text('6:00 PM'), findsOneWidget);
    expect(find.text(CorrectionWords.reasonMissing), findsOneWidget);

    await typeInto(tester, CorrectionWords.why, 'I left for a client meeting and forgot to check out.');
    expect(find.textContaining('Ready to send: forgot to check out on ${dayWords(yesterday)}'), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/attendance/corrections'), {
      'date': yesterday,
      'kind': 'forgot_check_out',
      'reason': 'I left for a client meeting and forgot to check out.',
      'checkOut': '18:00',
    });
    expect(find.text('Request sent. It goes to your direct manager, then HR; each step shows on the request.'), findsOneWidget);
  }, skip: !sameMonth);

  testWidgets('asks for a time when a time is wrong', (tester) async {
    await openSheet(tester, correctionPeople(), showCorrectionSheet);
    await scrollAndTap(tester, find.text('A time is wrong'));
    expect(find.text(CorrectionWords.enterEither), findsOneWidget);
    expect(find.text('${CorrectionWords.cameIn} ${RequestsWords.optional}'), findsOneWidget);
  });

  testWidgets('says why a month’s days can’t be corrected any more', (tester) async {
    final people = correctionPeople(month: monthJson(allowed: false));
    await openSheet(tester, people, showCorrectionSheet);
    expect(find.text('The October $y payroll is approved, so its days can’t be corrected any more.'), findsOneWidget);
    await typeInto(tester, CorrectionWords.why, 'Forgot');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.calls, isNot(contains('POST /api/me/attendance/corrections')));
  });

  testWidgets('shows People’s refusal in its words', (tester) async {
    final people = correctionPeople()
      ..on('POST /api/me/attendance/corrections', (req) => json({'message': ['You checked out at 18:05 on $yesterday already: choose “A time is wrong” to change it.'], 'statusCode': 400}, 400));
    await openSheet(tester, people, showCorrectionSheet);
    await typeInto(tester, CorrectionWords.why, 'Forgot');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(find.text('You checked out at 6:05 PM on ${dmy(yesterday)} already: choose “A time is wrong” to change it.'), findsOneWidget);
  }, skip: !sameMonth);

  testWidgets('its page: the day, what was wrong, what was on record, and Cancel', (tester) async {
    final c = correctionJson();
    final people = requestsPeople()
      ..on(
        'POST /api/me/attendance/corrections/c1/cancel',
        (req) => json({
          ...c,
          'status': 'cancelled',
          'canCancel': false,
          'steps': [...c['steps']! as List, stepJson('cancelled')],
        }),
      );
    await openSheet(
      tester,
      people,
      (context) async => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => RequestPage(kind: RequestKind.correction, id: 'c1', initial: requestOf(RequestKind.correction, c))),
      ),
    );
    expect(find.text(CorrectionWords.pageTitle), findsOneWidget);
    expect(find.text(dayWords('$y-10-21')), findsOneWidget);
    expect(find.text('Forgot to check out'), findsOneWidget);
    expect(find.textContaining('– no check-out'), findsOneWidget);
    expect(find.text('Checked in on the system'), findsOneWidget);
    expect(find.text('Waiting for HR'), findsOneWidget);

    await tester.scrollUntilVisible(find.text(CorrectionWords.cancelButton), 200, scrollable: find.byType(Scrollable).last);
    await scrollAndTap(tester, find.text(CorrectionWords.cancelButton));
    expect(find.text(CorrectionWords.cancelConfirm(dayWords('$y-10-21'))), findsOneWidget);
    await tester.tap(find.text(CorrectionWords.cancelButton).last);
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/me/attendance/corrections/c1/cancel'));
    await tester.scrollUntilVisible(find.text(CorrectionWords.cancelled), -200, scrollable: find.byType(Scrollable).last);
    await tester.scrollUntilVisible(find.text(CorrectionWords.stepCancelled), 200, scrollable: find.byType(Scrollable).last);
  });
}
