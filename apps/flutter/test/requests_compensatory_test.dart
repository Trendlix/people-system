import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/compensatory.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/request_forms.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A compensatory day in a few taps (README Phase 2): the sheet starts on the latest rest day worked with a check-in kept
// and the next free working day off, keeps Compensatory Setup's rules in sight, and sends what the API takes; People's
// refusals in its words; the request's page as the website's. The form's dates are fixed (People's "today" is the
// form's): 30/10/2026 is a Friday, 24/10/2026 a Saturday, 01/11/2026 a Sunday.

Map<String, Object?> compensatoryForm({String? refusal, List<String> checkedIn = const ['2026-10-24'], List<String> claimed = const []}) => {
  ...compensatoryFormJson(),
  'refusal': refusal,
  'offered': refusal == null,
  'today': '2026-10-30',
  'rules': {'cashRate': 1.5, 'minHours': 2, 'hoursCap': 4, 'fullDayHours': 6, 'offWithinDays': 10},
  'checkedIn': checkedIn,
  'claimed': claimed,
  'from': '2026-08-30',
  'to': '2026-12-31',
};

void main() {
  late FakePeople people;

  setUp(() {
    people = requestsPeople()
      ..on('GET /api/me/compensatory/form', (req) => json(compensatoryForm()))
      ..on('POST /api/me/compensatory', (req) => json(compensatoryJson(), 201));
  });

  testWidgets('sends the latest rest day worked with the next free working day off, and opens its page', (tester) async {
    await openSheet(tester, people, showCompensatorySheet);
    expect(find.text('Saturday 24/10/2026'), findsOneWidget);
    expect(find.text('Sunday 01/11/2026'), findsOneWidget);
    expect(find.text(CompensatoryWords.earnsWholeDay), findsOneWidget);
    expect(find.text(CompensatoryWords.ready(CompensatoryWords.readyDay('Saturday 24/10/2026', 'Sunday 01/11/2026'), false)), findsOneWidget);

    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/compensatory'), {'dayWorked': '2026-10-24', 'dayOff': '2026-11-01'});
    expect(find.text('Request sent. It goes to your direct manager, then HR; each step shows on the request.'), findsOneWidget);
  });

  testWidgets('sends part of the day with its hours, and what they earn shows as they are typed', (tester) async {
    await openSheet(tester, people, showCompensatorySheet);
    await scrollAndTap(tester, find.text(CompensatoryWords.partOfTheDay));
    expect(find.text(CompensatoryWords.enterHours), findsOneWidget);
    await typeInto(tester, CompensatoryWords.hoursWorkedThatDay, '1');
    expect(find.text(CompensatoryWords.earnsNothing('2 hours')), findsOneWidget);
    expect(find.text(CompensatoryWords.fewerThanMin('1 hour', '2 hours')), findsOneWidget);
    await typeInto(tester, CompensatoryWords.hoursWorkedThatDay, '5');
    expect(find.text(CompensatoryWords.earnsHours('4 hours', '4')), findsOneWidget);
    await typeInto(tester, CompensatoryWords.reason, 'Shoot on Saturday');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.bodyOf('POST /api/me/compensatory'), {'dayWorked': '2026-10-24', 'dayOff': '2026-11-01', 'hoursWorked': 5, 'reason': 'Shoot on Saturday'});
  });

  testWidgets('a day already claimed is left out, and nothing is sent without a day worked', (tester) async {
    people.on('GET /api/me/compensatory/form', (req) => json(compensatoryForm(claimed: const ['2026-10-24'])));
    await openSheet(tester, people, showCompensatorySheet);
    expect(find.text(CompensatoryWords.enterDayWorked), findsOneWidget);
    expect(find.text(RequestsWords.send), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.calls, isNot(contains('POST /api/me/compensatory')));
  });

  testWidgets('shows People’s refusal in its words and keeps the sheet', (tester) async {
    people.on(
      'POST /api/me/compensatory',
      (req) => json({'statusCode': 409, 'message': 'The October 2026 payroll is approved, so its days can’t change. Choose days in another month.'}, 409),
    );
    await openSheet(tester, people, showCompensatorySheet);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(find.text('The October 2026 payroll is approved, so its days can’t change. Choose days in another month.'), findsOneWidget);
    expect(find.text(RequestsWords.send), findsOneWidget);
  });

  testWidgets('says why someone can’t ask, with no form', (tester) async {
    people.on('GET /api/me/compensatory/form', (req) => json(compensatoryForm(refusal: 'You work freelance, outside the labour law and its working hours: there is no compensatory day.')));
    await openSheet(tester, people, showCompensatorySheet);
    expect(find.text('You work freelance, outside the labour law and its working hours: there is no compensatory day.'), findsOneWidget);
    expect(find.text(RequestsWords.send), findsNothing);
  });

  test('reads the form by hand', () {
    final f = CompensatoryForm.fromJson(compensatoryForm());
    expect(f.asks, isTrue);
    expect(f.rules.offWithinDays, 10);
    expect(f.checkedIn, ['2026-10-24']);
    expect(CompensatoryForm.fromJson(compensatoryForm(refusal: 'No.')).asks, isFalse);
  });

  // The day worked picked from a menu (owner, 31 October 2026: "let the employee pick from a drop menu the eligable day, or
  // choose a future day in the same month only, for upcomming days"). Today Friday 30/10/2026, the day off within 10 days.
  group('the day worked’s menu', () {
    testWidgets('lists the days worked and those coming up this month, each with what it is; asks ahead for one to come', (tester) async {
      await openSheet(tester, people, showCompensatorySheet);
      expect(find.text(CompensatoryWords.dayWorkedHint), findsOneWidget);
      await scrollAndTap(tester, find.text('Saturday 24/10/2026'));
      expect(find.text(CompensatoryWords.groupWorked), findsOneWidget);
      expect(find.text(CompensatoryWords.groupUpcoming), findsOneWidget);
      // 24/10 with its check-in; 30/10 (today) and 23/10 without; 31/10 to come
      expect(find.text('rest day · check-in kept'), findsOneWidget);
      expect(find.text('rest day · no check-in: HR will ask to confirm'), findsNWidgets(2));
      expect(find.text('Friday 30/10/2026'), findsOneWidget);
      expect(find.text('Friday 23/10/2026'), findsOneWidget);
      expect(find.text(CompensatoryWords.eligibleNote(null, true, false)), findsOneWidget);
      await tester.tap(find.text('Saturday 31/10/2026').last);
      await tester.pumpAndSettle();
      // nothing to check in yet; the day off the next free working day after it, in the window
      expect(find.text(CompensatoryWords.noCheckIn('31/10/2026')), findsNothing);
      expect(find.text('Sunday 01/11/2026'), findsOneWidget);
      await scrollAndTap(tester, find.text(RequestsWords.send));
      expect(people.bodyOf('POST /api/me/compensatory'), {'dayWorked': '2026-10-31', 'dayOff': '2026-11-01'});
    });

    testWidgets('a day gone by with no check-in kept is warned of once picked', (tester) async {
      await openSheet(tester, people, showCompensatorySheet);
      await scrollAndTap(tester, find.text('Saturday 24/10/2026'));
      await tester.tap(find.text('Friday 23/10/2026').last);
      await tester.pumpAndSettle();
      expect(find.text(CompensatoryWords.noCheckIn('23/10/2026')), findsOneWidget);
    });

    testWidgets('takes People’s days as sent, with the holiday’s name', (tester) async {
      people.on(
        'GET /api/me/compensatory/form',
        (req) => json({
          ...compensatoryForm(),
          'eligibleDays': [
            {'date': '2026-10-31', 'when': 'upcoming', 'holiday': 'Test Day', 'checkedIn': false},
          ],
        }),
      );
      await openSheet(tester, people, showCompensatorySheet);
      // none worked with a check-in kept: nothing picked yet
      expect(find.text(CompensatoryWords.enterDayWorked), findsOneWidget);
      expect(find.text(CompensatoryWords.chooseDayWorked), findsOneWidget);
      await scrollAndTap(tester, find.byType(DayWorkedMenu));
      expect(find.text(CompensatoryWords.groupWorked), findsNothing);
      expect(find.text('Test Day (official holiday)'), findsOneWidget);
      await tester.tap(find.text('Saturday 31/10/2026').last);
      await tester.pumpAndSettle();
      await scrollAndTap(tester, find.text(RequestsWords.send));
      expect(people.bodyOf('POST /api/me/compensatory'), {'dayWorked': '2026-10-31', 'dayOff': '2026-11-01'});
    });

    testWidgets('says plainly when no day can be asked for, and sends nothing', (tester) async {
      people.on('GET /api/me/compensatory/form', (req) => json({...compensatoryForm(), 'eligibleDays': <Object>[]}));
      await openSheet(tester, people, showCompensatorySheet);
      expect(find.text(CompensatoryWords.noDays(10)), findsOneWidget);
      expect(find.text(CompensatoryWords.chooseDayWorked), findsNothing);
      await scrollAndTap(tester, find.text(RequestsWords.send));
      expect(people.calls, isNot(contains('POST /api/me/compensatory')));
    });

    test('worked out by People’s rule from a People from before it: the same days as the website', () {
      final f = CompensatoryForm.fromJson({
        ...compensatoryForm(),
        'today': '2026-11-12',
        'rules': {'cashRate': 1.5, 'minHours': 2, 'hoursCap': 4, 'fullDayHours': 6, 'offWithinDays': null},
        'holidays': [
          {'date': '2026-11-10', 'nameEn': 'Test Day'},
          {'date': '2026-11-24', 'nameEn': 'Later Day'},
        ],
        'claimed': ['2026-11-07'],
        'checkedIn': ['2026-11-06'],
      });
      expect(f.eligibleDays, isNull);
      final days = eligibleDaysOf(f);
      expect(days.where((d) => !d.upcoming).toList(), [
        (date: '2026-11-10', upcoming: false, holiday: 'Test Day', checkedIn: false),
        (date: '2026-11-06', upcoming: false, holiday: null, checkedIn: true),
      ]);
      expect(days.where((d) => d.upcoming).map((d) => d.date), ['2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21', '2026-11-24', '2026-11-27', '2026-11-28']);
      // a day of next month is refused, never offered
      expect(CompensatoryWords.thisMonthOnly('04/12/2026', 'December 2026', '30/11/2026'), '04/12/2026 is in December 2026: a day still to come can be asked for in this month only, up to 30/11/2026.');
    });

    test('on the last day of a month in the same-month window, nothing until tomorrow', () {
      final f = CompensatoryForm.fromJson({
        ...compensatoryForm(),
        'today': '2026-10-31',
        'rules': {'cashRate': 1.5, 'minHours': 2, 'hoursCap': 4, 'fullDayHours': 6, 'offWithinDays': null},
      });
      expect(eligibleDaysOf(f), isEmpty);
      expect(
        noEligibleDaysText(f),
        'No day can be asked for today: the day off must be a working day in the same month as the day worked, from tomorrow, and today is the last day of October 2026. From 01/11/2026 you can ask for November’s rest days and official holidays, worked or coming up.',
      );
    });

    test('People’s days read by hand', () {
      final f = CompensatoryForm.fromJson({
        ...compensatoryForm(),
        'eligibleDays': [
          {'date': '2026-10-24', 'when': 'worked', 'holiday': null, 'checkedIn': true},
          {'date': '2026-10-31', 'when': 'upcoming', 'holiday': 'Test Day', 'checkedIn': false},
        ],
      });
      expect(f.eligibleDays, [
        (date: '2026-10-24', upcoming: false, holiday: null, checkedIn: true),
        (date: '2026-10-31', upcoming: true, holiday: 'Test Day', checkedIn: false),
      ]);
    });
  });

  test('its page says a day worked was asked ahead, still to come or since worked', () {
    String noteOf(Map<String, Object?> extra) =>
        compensatoryDetail(CompensatoryRequest.fromJson({...compensatoryJson(), ...extra})).facts.firstWhere((f) => f.label == CompensatoryWords.dayWorked).note!;
    expect(noteOf({'upcoming': true, 'askedAhead': true, 'noCheckIn': false}), '${CompensatoryWords.dayWorkedNote}\n${CompensatoryWords.stillToComeNote}');
    expect(noteOf({'upcoming': false, 'askedAhead': true, 'noCheckIn': true}), '${CompensatoryWords.dayWorkedNote}\n${CompensatoryWords.askedAheadNote}\n${CompensatoryWords.noCheckInNote}');
    expect(noteOf({}), CompensatoryWords.dayWorkedNote);
  });

  test('its page: the days, every step; cancel while it is decided, never one carried by an official duty', () {
    final d = compensatoryDetail(CompensatoryRequest.fromJson(compensatoryJson()));
    expect(d.title, CompensatoryWords.title);
    expect(d.status, 'With the manager');
    expect(d.state, RequestState.waiting);
    final facts = {for (final f in d.facts) f.label: f.value};
    expect(facts[CompensatoryWords.dayWorked], dayWords('$y-10-24'));
    expect(facts[CompensatoryWords.dayOffAskedFor], dayWords('$y-10-29'));
    expect(facts[RequestsWords.whereItStands], 'With the direct manager (Sara Ali)');
    expect(d.steps.single.text, 'Asked for by the employee');
    expect(d.actions.single.path, '/api/me/compensatory/k1/cancel');
    expect(d.banner, isNull);

    final withOd = compensatoryDetail(
      CompensatoryRequest.fromJson({
        ...compensatoryJson(),
        'hoursWorked': 5,
        'hoursOff': 4,
        'od': {'id': 'o1', 'startDate': '$y-10-24', 'status': 'with_manager'},
        'canCancel': false,
      }),
    );
    expect(withOd.banner, CompensatoryWords.withOd('24/10/$y'));
    expect(withOd.actions, isEmpty);
    final f = {for (final x in withOd.facts) x.label: x.value};
    expect(f[CompensatoryWords.hoursWorked], '5 hours: earned 4 hours off (capped at 4)');
    expect(f[CompensatoryWords.dayForTheHoursOff], '4 hours off on ${dayWords('$y-10-29')}');
  });
}
