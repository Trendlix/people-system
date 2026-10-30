import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/history.dart';
import 'package:people/features/requests/kinds/leave.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/theme/parts.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// The Requests tab (the phone design's My Requests, 30 October 2026) and its New leave sheet (README Phase 2, "faster
// requests"): the annual leave, the figures, Recent requests with its filter, the other leave, the requests People lets
// them start; a leave sent in a few taps with what People's form takes, its refusals in its words, and its page.

/// The first working day from today, as the sheet starts the leave (the fixtures' shift: Sunday to Thursday).
String firstDay() => nextWorkingDay(todayIso(), const [0, 1, 2, 3, 4], const {});

Finder filterTab(String label) => find.descendant(of: find.byType(SegmentedTabs<HistoryFilter>), matching: find.text(label));

/// Scrolls the tab (built as it scrolls) until [f] shows.
Future<void> reveal(WidgetTester tester, Finder f, [double delta = 300]) async {
  await tester.scrollUntilVisible(f, delta, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

Future<void> sendLeave(WidgetTester tester) async {
  await tester.ensureVisible(find.text(RequestsWords.send));
  await tester.pumpAndSettle();
  await tester.tap(find.text(RequestsWords.send));
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;

  setUp(() => people = requestsPeople());

  testWidgets('shows the annual leave, the figures, recent requests and the other leave', (tester) async {
    await openRequestsTab(tester, people);
    expect(find.text(RequestsWords.title), findsOneWidget);
    expect(find.text(RequestsWords.annualOf(y)), findsOneWidget);
    expect(find.text(RequestsWords.available), findsOneWidget);
    expect(find.text('19'), findsOneWidget);
    expect(find.text('90%'), findsOneWidget);
    expect(find.text(RequestsWords.requestsThisYear), findsOneWidget);
    expect(find.text('02'), findsOneWidget);
    expect(find.text(RequestsWords.bothApproved), findsOneWidget);
    expect(find.text(RequestsWords.permissionLeft), findsOneWidget);
    expect(find.text('4:00'), findsOneWidget);

    await reveal(tester, find.text(RequestsWords.recentRequests));
    expect(find.text('Casual leave'), findsWidgets);
    expect(find.text(RequestsWords.recordedByHrOn('26/10/$y')), findsOneWidget);
    expect(find.text('Permission'), findsWidgets);

    // nothing waiting: the filter says so
    await tester.tap(filterTab(RequestsWords.waiting));
    await tester.pumpAndSettle();
    expect(find.text(RequestsWords.emptyWaiting), findsOneWidget);
    await tester.tap(filterTab(RequestsWords.all));
    await tester.pumpAndSettle();

    await reveal(tester, find.text(RequestsWords.otherLeave));
    expect(find.text('of 7 days left this year'), findsOneWidget);
    expect(find.text('days used this year'), findsNWidgets(2));
    // the design's "View leave policy" has no page in People
    expect(find.text('View leave policy'), findsNothing);
  });

  testWidgets('offers only the requests People lets them start', (tester) async {
    people
      ..on('GET /api/me/wfh/allowance', (req) => json(wfhAllowanceJson(offered: false)))
      ..on('GET /api/me/resignation', (req) => json({'requests': <Object>[], 'form': resignationFormJson(offered: false, refusal: 'Ask HR.')}))
      ..on('GET /api/me/official-duty', (req) => json({'message': 'Not found.'}, 404));
    await openRequestsTab(tester, people);
    await reveal(tester, find.text(RequestsWords.startAnother), 400);
    for (final kind in ['permission', 'correction', 'compensatory', 'home', 'claim']) {
      await reveal(tester, find.text(RequestsWords.startCards[kind]!.$3));
      expect(find.text(RequestsWords.startCards[kind]!.$3), findsOneWidget, reason: kind);
    }
    for (final kind in ['wfh', 'od', 'resignation']) {
      expect(find.text(RequestsWords.startCards[kind]!.$2), findsNothing, reason: kind);
    }
    // an API without official duty isn't a failure to say
    expect(find.textContaining('couldn’t be loaded'), findsNothing);
  });

  testWidgets('says which kinds couldn’t be loaded, and the rest still shows', (tester) async {
    people.on('GET /api/me/reimbursements', (req) => json({'message': 'Something broke.'}, 500));
    await openRequestsTab(tester, people);
    await reveal(tester, find.text(RequestsWords.recentRequests));
    expect(find.text(RequestsWords.failedOf(['reimbursements'])), findsOneWidget);
    expect(find.text('Casual leave'), findsWidgets);
  });

  testWidgets('sends a leave in a few taps: annual leave, the next working day, a reason', (tester) async {
    people.on('POST /api/me/leave/requests', (req) => json(leaveJson(id: 'new1', start: firstDay(), end: firstDay(), days: 1), 201));
    await openRequestsTab(tester, people);
    await tester.tap(find.text(RequestsWords.createRequest));
    await tester.pumpAndSettle();
    expect(find.text(LeaveWords.title), findsOneWidget);
    expect(find.text(LeaveWords.intro(false)), findsOneWidget);
    expect(find.text(LeaveWords.annualAvailable(y, '19')), findsOneWidget);
    expect(find.text(dayWords(firstDay())), findsNWidgets(2));
    expect(find.text(LeaveWords.countFromAnnual('1 day', '18')), findsOneWidget);

    await typeInto(tester, LeaveWords.reason, 'Family trip');
    expect(find.text(LeaveWords.ready('1 day', 'Annual leave', 'HR', false)), findsOneWidget);
    await sendLeave(tester);

    final sent = lastSent(people, 'POST /api/me/leave/requests');
    expect(sent.headers['content-type'], startsWith('multipart/form-data'));
    expect(sent.headers['authorization'], 'Bearer kept');
    expect(formFields(sent), {'typeId': 't-annual', 'startDate': firstDay(), 'endDate': firstDay(), 'halfDay': 'false', 'reason': 'Family trip'});
    expect(formFiles(sent), isEmpty);
    // its page opens in the tab, saying where it goes next
    expect(find.text(RequestsWords.sentGoesTo('your direct manager', 'HR')), findsOneWidget);
    expect(find.text('With the direct manager (Sara Ali)'), findsOneWidget);
  });

  testWidgets('asks for a document when the type needs one, and sends the photo with it', (tester) async {
    final photos = FakePhotos('sick-note.jpg');
    people.on('POST /api/me/leave/requests', (req) => json(leaveJson(type: 'Sick leave', typeKey: 'sick', id: 'new2'), 201));
    await openRequestsTab(tester, people, photos: photos);
    await tester.tap(find.text(RequestsWords.createRequest));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sick leave').last);
    await tester.pumpAndSettle();
    expect(find.text(LeaveWords.documentsRequired), findsOneWidget);
    expect(find.text(LeaveWords.needsDocument('Sick leave')), findsOneWidget);

    // not sent while a document is missing
    await sendLeave(tester);
    expect(people.calls, isNot(contains('POST /api/me/leave/requests')));

    await tester.ensureVisible(find.text(RequestsWords.takePhoto));
    await tester.tap(find.text(RequestsWords.takePhoto));
    await tester.pumpAndSettle();
    expect(photos.picked, 1);
    expect(find.textContaining('sick-note.jpg'), findsOneWidget);
    await sendLeave(tester);
    final sent = lastSent(people, 'POST /api/me/leave/requests');
    expect(formFields(sent)['typeId'], 't-sick');
    expect(formFiles(sent), [('documents', 'sick-note.jpg')]);
  });

  testWidgets('names the colleague who covers when People says one is needed', (tester) async {
    people
      ..on('GET /api/me/leave/coverage', (req) => json(coverageJson(required: true)))
      ..on('POST /api/me/leave/requests', (req) => json(leaveJson(id: 'new3'), 201));
    await openRequestsTab(tester, people);
    await tester.tap(find.text(RequestsWords.createRequest));
    await tester.pumpAndSettle();
    expect(find.text(LeaveWords.needsCover), findsOneWidget);
    expect(find.text(LeaveWords.coverHintRequired), findsOneWidget);

    await tester.ensureVisible(find.text(LeaveWords.chooseColleague));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Omar Adel · Video · Production').last);
    await tester.pumpAndSettle();
    expect(find.text(LeaveWords.needsCover), findsNothing);
    await typeInto(tester, LeaveWords.handover, 'The edit is in the shared drive.');
    await sendLeave(tester);
    final fields = formFields(lastSent(people, 'POST /api/me/leave/requests'));
    expect(fields['coverId'], 'c-omar');
    expect(fields['handoverNote'], 'The edit is in the shared drive.');
  });

  testWidgets('shows People’s refusal in its words, its dates as the website shows them', (tester) async {
    people.on(
      'POST /api/me/leave/requests',
      (req) => json({
        'statusCode': 409,
        'message': 'You already have Annual leave from $y-11-02 to $y-11-04 (with HR) on some of these days. Choose other days.',
      }, 409),
    );
    await openRequestsTab(tester, people);
    await tester.tap(find.text(RequestsWords.createRequest));
    await tester.pumpAndSettle();
    await sendLeave(tester);
    expect(find.text('You already have Annual leave from 02/11/$y to 04/11/$y (with HR) on some of these days. Choose other days.'), findsOneWidget);
    // the sheet stays open to change the days
    expect(find.text(LeaveWords.title), findsOneWidget);
  });

  testWidgets('opens a request from Recent requests, and cancels a leave being decided', (tester) async {
    people
      ..on('GET /api/me/leave/requests', (req) => json([leaveJson(id: 'l1', status: 'with_hr')]))
      ..on('POST /api/me/leave/requests/l1/cancel', (req) => json({
            ...leaveJson(id: 'l1', status: 'cancelled', canCancel: false),
            'steps': [stepJson('submitted'), stepJson('cancelled')],
          }));
    await openRequestsTab(tester, people);
    await reveal(tester, find.text('Annual leave'));
    await tester.tap(find.text('Annual leave'));
    await tester.pumpAndSettle();
    expect(find.text(RequestsWords.theRequest.toUpperCase()), findsOneWidget);
    expect(find.text('Waiting for HR'), findsOneWidget);
    expect(find.text('Family trip'), findsOneWidget);

    await reveal(tester, find.text(LeaveWords.cancelButton));
    await tester.tap(find.text(LeaveWords.cancelButton));
    await tester.pumpAndSettle();
    expect(find.text(LeaveWords.cancelConfirm('Annual leave', '02/11/$y – 04/11/$y')), findsOneWidget);
    await tester.tap(find.text(LeaveWords.cancelButton).last);
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/me/leave/requests/l1/cancel'));
    await reveal(tester, find.text(LeaveWords.cancelled), -300);
    expect(find.text(LeaveWords.cancelled), findsOneWidget);
    expect(find.text(LeaveWords.cancelButton), findsNothing);
  });

  testWidgets('says why there are no requests for an account on hold', (tester) async {
    people.on('GET /api/auth/me', (req) => json(meJson(hold: true)));
    await openRequestsTab(tester, people);
    expect(find.text(RequestsWords.title), findsOneWidget);
    expect(find.text(RequestsWords.createRequest), findsNothing);
  });
}
