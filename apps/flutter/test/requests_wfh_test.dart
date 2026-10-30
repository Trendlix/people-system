import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/wfh.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/request_forms.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// Working from home in a few taps (README Phase 2): the next day possible chosen already, the month's days shown; asked
// a day before, within the days a month and days apart, as People checks it; its refusals in its words; the page.

void main() {
  test('reads a work from home day and the allowance by hand', () {
    final w = WfhRequest.fromJson(wfhJson());
    expect((w.date, w.status, w.monthUsed, w.source), ('$y-10-15', 'rejected', 1, 'system'));
    expect(w.rejectReason, 'We need you at the shoot that day.');
    final a = WfhAllowance.fromJson({
      ...wfhAllowanceJson(),
      'taken': [
        {'date': '$y-11-05', 'status': 'approved'},
      ],
    });
    expect((a.daysPerMonth, a.minGapDays, a.nextPossible, a.asks), (2, 7, '$y-11-02', true));
    expect(wfhAllowanceLine(a), '0 of 2 this month · next possible from 02/11/$y');
    expect(wfhAllowanceLine(a, '$y-11-20'), '1 of 2 in November $y · next possible from 02/11/$y');
  });

  test('checks the notice, the days a month and the days apart as People does', () {
    final a = WfhAllowance.fromJson({
      ...wfhAllowanceJson(),
      'taken': [
        {'date': '$y-11-05', 'status': 'approved'},
        {'date': '$y-11-20', 'status': 'with_manager'},
      ],
    });
    expect(wfhProblems(a, '$y-10-29'), ['29/10/$y has gone by: ask for a work from home day a day before it at the latest.']);
    expect(wfhProblems(a, '$y-10-30'), ['30/10/$y is today: ask for a work from home day a day before it at the latest.']);
    expect(wfhProblems(a, '$y-11-05'), ['You have a work from home day on 05/11/$y already.']);
    expect(wfhProblems(a, '$y-11-12'), ['November $y\'s 2 days of working from home are already asked for: 2 of 2.']);
    expect(wfhProblems(a, '$y-11-09'), contains('Two work from home days must be at least 7 days apart: 09/11/$y is 4 days from your day on 05/11/$y.'));
    expect(wfhProblems(a, '$y-12-01'), isEmpty);
  });

  testWidgets('asks for the next day possible in a few taps', (tester) async {
    final people = requestsPeople()..on('POST /api/me/wfh', (req) => json({...wfhJson(id: 'w9', status: 'with_manager'), 'date': '$y-11-02', 'canCancel': true}, 201));
    await openSheet(tester, people, showWfhSheet);
    expect(find.text(WfhWords.title), findsOneWidget);
    // the chosen day's month: next month's days
    expect(find.text('0 of 2 in November $y · next possible from 02/11/$y'), findsOneWidget);
    expect(find.text('At most 2 days a month, any two at least 7 days apart, asked a day before at the latest, as Leave Setup gives it.'), findsOneWidget);
    expect(find.text(dayWords('$y-11-02')), findsOneWidget);

    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/wfh'), {'date': '$y-11-02'});
    expect(find.text('Request sent. It goes to your direct manager, then HR; each step shows on the request.'), findsOneWidget);
  });

  testWidgets('sends the reason when one is written', (tester) async {
    final people = requestsPeople()..on('POST /api/me/wfh', (req) => json(wfhJson(status: 'with_manager'), 201));
    await openSheet(tester, people, showWfhSheet);
    await typeInto(tester, WfhWords.reason, 'A delivery at home');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/wfh'), {'date': '$y-11-02', 'reason': 'A delivery at home'});
  });

  testWidgets('shows why they can’t ask, in People’s words', (tester) async {
    final people = requestsPeople()
      ..on('GET /api/me/wfh/allowance', (req) => json({...wfhAllowanceJson(offered: false), 'refusal': 'You work from home already: no work from home day is needed.'}));
    await openSheet(tester, people, showWfhSheet);
    expect(find.text('You work from home already: no work from home day is needed.'), findsOneWidget);
    expect(find.text(RequestsWords.send), findsNothing);
  });

  testWidgets('shows People’s refusal when it is sent', (tester) async {
    final people = requestsPeople()
      ..on('POST /api/me/wfh', (req) => json({'message': ['$y-11-02 is an official holiday (Revolution Day): there is no work that day.'], 'statusCode': 400}, 400));
    await openSheet(tester, people, showWfhSheet);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(find.text('02/11/$y is an official holiday (Revolution Day): there is no work that day.'), findsOneWidget);
  });

  testWidgets('its page: the day, its month, who rejected it and why', (tester) async {
    final people = requestsPeople();
    await openSheet(
      tester,
      people,
      (context) async => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => RequestPage(kind: RequestKind.wfh, id: 'w1', initial: requestOf(RequestKind.wfh, wfhJson()))),
      ),
    );
    expect(find.text(WfhWords.pageTitle), findsOneWidget);
    expect(find.text(dayWords('$y-10-15')), findsOneWidget);
    expect(find.text('1 taken'), findsOneWidget);
    expect(find.text('Rejected by the direct manager'), findsOneWidget);
    // under where it stands, and with the manager's step
    expect(find.text('“We need you at the shoot that day.”'), findsWidgets);
    expect(find.text(WfhWords.cancelButton), findsNothing);
    await tester.scrollUntilVisible(find.text('The direct manager rejected it'), 200, scrollable: find.byType(Scrollable).last);
  });
}
