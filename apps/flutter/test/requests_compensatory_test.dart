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
