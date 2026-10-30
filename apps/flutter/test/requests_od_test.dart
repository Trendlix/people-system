import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/od.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/request_forms.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// Official duty in a few taps (README Phase 2): the sheet starts on the first working day with the shift's hours, keeps
// People's rules in sight (3 days after at the latest, within the shift, a rest day's compensation) and sends what the
// API takes; People's refusals in its words; the request's page as the website's. The form's dates are fixed (People's
// "today" is the form's), so the tests don't hang on the calendar: 29/10/2026 is a Thursday, 30/10/2026 a Friday.

Map<String, Object?> odForm({String today = '2026-10-29', String earliest = '2026-10-26', List<int> workingDays = const [0, 1, 2, 3, 4]}) => {
  ...odFormJson(),
  'today': today,
  'earliest': earliest,
  'workingDays': workingDays,
};

void main() {
  late FakePeople people;

  setUp(() {
    people = requestsPeople()
      ..on('GET /api/me/official-duty/form', (req) => json(odForm()))
      ..on('POST /api/me/official-duty', (req) => json(odJson(status: 'with_manager'), 201));
  });

  testWidgets('sends a full day on the first working day, with where and why, and opens its page', (tester) async {
    await openSheet(tester, people, showOdSheet);
    expect(find.text(OdWords.shiftNote('9:00 AM', '6:00 PM')), findsOneWidget);
    expect(find.text('Thursday 29/10/2026'), findsOneWidget);
    expect(find.text(RequestsWords.beforeYouSend), findsOneWidget);
    expect(find.text(OdWords.writePlace), findsOneWidget);

    await typeInto(tester, OdWords.where, 'Client’s office, New Cairo');
    await typeInto(tester, OdWords.reason, 'Launch shoot');
    expect(find.text(OdWords.ready('Thursday 29/10/2026', '', false)), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));

    expect(people.bodyOf('POST /api/me/official-duty'), {
      'startDate': '2026-10-29',
      'endDate': '2026-10-29',
      'fullDay': true,
      'place': 'Client’s office, New Cairo',
      'reason': 'Launch shoot',
    });
    expect(find.text('Request sent. It goes to your direct manager, then HR; each step shows on the request.'), findsOneWidget);
    expect(find.text(OdWords.title), findsWidgets);
  });

  testWidgets('sends part of a day with the shift’s hours', (tester) async {
    await openSheet(tester, people, showOdSheet);
    await scrollAndTap(tester, find.text(OdWords.partOfADay));
    expect(find.text('9:00 AM'), findsOneWidget);
    expect(find.text('6:00 PM'), findsOneWidget);
    await typeInto(tester, OdWords.where, 'Studio, Zamalek');
    await typeInto(tester, OdWords.reason, 'Shoot');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/official-duty'), {
      'startDate': '2026-10-29',
      'endDate': '2026-10-29',
      'fullDay': false,
      'fromTime': '09:00',
      'toTime': '18:00',
      'place': 'Studio, Zamalek',
      'reason': 'Shoot',
    });
  });

  testWidgets('on a rest day it asks for the compensation, and sends cash instead', (tester) async {
    people.on('GET /api/me/official-duty/form', (req) => json(odForm(today: '2026-10-30', earliest: '2026-10-27', workingDays: const [])));
    await openSheet(tester, people, showOdSheet);
    expect(find.text('Friday 30/10/2026'), findsOneWidget);
    expect(
      find.text(OdWords.earns(OdWords.what('Friday 30/10/2026', null), OdWords.aWholeDayOff, '1.5 days’ pay')),
      findsOneWidget,
    );
    await scrollAndTap(tester, find.text(OdWords.cashInstead));
    expect(find.text(OdWords.cashHint('1.5 days’ pay')), findsOneWidget);
    await typeInto(tester, OdWords.where, 'Client’s office');
    await typeInto(tester, OdWords.reason, 'Weekend launch');
    expect(find.text(OdWords.ready('Friday 30/10/2026', OdWords.paidInstead('1.5 days’ pay'), false)), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/official-duty'), {
      'startDate': '2026-10-30',
      'endDate': '2026-10-30',
      'fullDay': true,
      'place': 'Client’s office',
      'reason': 'Weekend launch',
      'compensation': 'cash',
    });
  });

  testWidgets('shows People’s refusal in its words and keeps the sheet', (tester) async {
    people.on(
      'POST /api/me/official-duty',
      (req) => json({
        'statusCode': 400,
        'message': ['You have a work from home day on 2026-10-29 (approved): ask for one or the other.'],
      }, 400),
    );
    await openSheet(tester, people, showOdSheet);
    await typeInto(tester, OdWords.where, 'Client’s office');
    await typeInto(tester, OdWords.reason, 'Visit');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(find.text('You have a work from home day on 29/10/2026 (approved): ask for one or the other.'), findsOneWidget);
    expect(find.text(RequestsWords.send), findsOneWidget);
  });

  testWidgets('says why someone can’t ask, with no form', (tester) async {
    people.on('GET /api/me/official-duty/form', (req) => json({...odForm(), 'refusal': 'You work freelance, outside the labour law and its working hours: no official duty is needed.'}));
    await openSheet(tester, people, showOdSheet);
    expect(find.text('You work freelance, outside the labour law and its working hours: no official duty is needed.'), findsOneWidget);
    expect(find.text(RequestsWords.send), findsNothing);
  });

  test('reads the form by hand', () {
    final f = OdForm.fromJson(odForm());
    expect(f.today, '2026-10-29');
    expect(f.shift?.startTime, '09:00');
    expect(f.rules?.fullDayHours, 6);
    expect(f.workingDays, [0, 1, 2, 3, 4]);
  });

  test('its page: the days, where, the reason, every step; cancel while it is decided', () {
    final approved = odDetail(OdRequest.fromJson(odJson()));
    expect(approved.title, OdWords.title);
    expect(approved.status, 'Approved');
    expect(approved.state, RequestState.approved);
    final facts = {for (final f in approved.facts) f.label: f.value};
    expect(facts[OdWords.day], '${weekdayName('$y-10-08')} 08/10/$y, 10:00 AM–2:00 PM');
    expect(facts[OdWords.whereFact], 'Client’s office, New Cairo');
    expect(facts[RequestsWords.whereItStands], 'Approved');
    expect(facts['Direct manager'], 'Sara Ali');
    expect(approved.steps.map((s) => s.text), ['Asked for by the employee', 'The direct manager approved it', 'HR approved it']);
    expect(approved.actions, isEmpty);
    expect(approved.notes.first, OdWords.approvedNote);

    final open = odDetail(
      OdRequest.fromJson({
        ...odJson(status: 'with_manager'),
        'canCancel': true,
        'startDate': '$y-10-30',
        'endDate': '$y-10-30',
        'fullDay': true,
        'compensation': {'id': 'k9', 'status': 'with_manager', 'outcome': 'day_off', 'dayOff': '$y-11-02', 'hoursWorked': null, 'hoursOff': null},
      }),
    );
    final f = {for (final x in open.facts) x.label: x};
    expect(f[OdWords.compensationFact]?.value, 'A day off on ${dayWords('$y-11-02')} · With the manager');
    expect(f[RequestsWords.whereItStands]?.value, 'With the direct manager (Sara Ali)');
    expect(open.actions.single.path, '/api/me/official-duty/o1/cancel');
    expect(open.actions.single.explain, contains('Its compensation (a day off on'));
  });
}
