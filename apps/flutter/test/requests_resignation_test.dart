
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/resignation.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A resignation request from the phone (README Phase 2): offered only when People's form says so; the reason, the
// preferred last day and the box ticked, sent as JSON with no letter (owner, 31 October 2026: "on the resignation, the
// letter is auto generated, viewed by the employee but uploaded by the HR"); People's refusals in its words; the
// request's page with Withdraw until HR records it, and no letter: HR's (owner, 5 November 2026: "make the HR generate the
// templete not the employee").

void main() {
  testWidgets('sends a resignation once the box is ticked, with the notice the rule gives shown and no letter to attach', (tester) async {
    final people = requestsPeople()..on('POST /api/me/resignation', (req) => json(resignationJson(), 201));
    await openSheet(tester, people, showResignationSheet);
    expect(find.text(ResignationWords.noticeHint('3 months', '${y + 1}-01-29')!), findsOneWidget);
    expect(find.text('Notice: 3 months, ending 29/01/${y + 1} if sent today.'), findsOneWidget);
    // People prepares the letter: nothing to photograph
    expect(find.text(RequestsWords.takePhoto), findsNothing);

    await typeInto(tester, ResignationWords.reason, 'Moving abroad.');
    expect(find.text(ResignationWords.tick), findsOneWidget);
    await scrollAndTap(tester, find.text(ResignationWords.send));
    expect(people.calls, isNot(contains('POST /api/me/resignation')));

    await scrollAndTap(tester, find.byType(Switch));
    expect(find.text(ResignationWords.tick), findsNothing);
    await scrollAndTap(tester, find.text(ResignationWords.send));

    final sent = lastSent(people, 'POST /api/me/resignation');
    expect(sent.headers['content-type'], startsWith('application/json'));
    expect(people.bodyOf('POST /api/me/resignation'), {'reason': 'Moving abroad.', 'preferredLastDay': '', 'confirmed': true});
    expect(find.text(ResignationWords.pageTitle), findsOneWidget);
    expect(find.text(ResignationWords.sent(false)), findsOneWidget);
  });

  testWidgets('says People’s refusal in its words', (tester) async {
    const refusal = 'You already have a resignation request waiting for HR. Withdraw it first to send another.';
    final people = requestsPeople()..on('POST /api/me/resignation', (req) => json({'statusCode': 409, 'message': refusal}, 409));
    await openSheet(tester, people, showResignationSheet);
    await typeInto(tester, ResignationWords.reason, 'Moving abroad.');
    await scrollAndTap(tester, find.byType(Switch));
    await scrollAndTap(tester, find.text(ResignationWords.send));
    expect(people.bodyOf('POST /api/me/resignation')['confirmed'], true);
    expect(find.text(refusal), findsOneWidget);
  });

  testWidgets('shows People’s reason, and no form, when a resignation can’t be sent', (tester) async {
    const refusal = 'A resignation request is for employment under the labour law. A freelancer or an intern is ended by HR instead: ask HR.';
    final people = requestsPeople()
      ..on('GET /api/me/resignation', (req) => json({'requests': <Object>[], 'form': resignationFormJson(offered: false, refusal: refusal)}));
    await openSheet(tester, people, showResignationSheet);
    expect(find.text(refusal), findsOneWidget);
    expect(find.text(ResignationWords.send), findsNothing);
  });

  test('a resignation’s page: the notice, the days, what became of it, and Withdraw until it is recorded', () {
    final d = resignationDetail(ResignationRequest.fromJson(resignationJson()));
    expect(d.title, ResignationWords.pageTitle);
    expect(d.status, 'Sent');
    String? fact(String label) => d.facts.where((f) => f.label == label).firstOrNull?.value;
    expect(fact(ResignationWords.noticeReceived), '30/10/$y');
    expect(fact(ResignationWords.ruleLastDay), '29/01/${y + 1} (3 months from the notice day)');
    expect(fact(ResignationWords.preferredFact), ResignationWords.noneGiven);
    expect(d.steps.single.text, ResignationWords.stepSent);
    expect(d.actions.single.path, '/api/me/resignation/x1/withdraw');
    // the letter is HR's (owner, 5 November 2026): nothing to open
    expect(d.opens, isNull);

    final recorded = resignationDetail(
      ResignationRequest.fromJson({
        ...resignationJson(status: 'recorded'),
        'recorded': {'at': '$y-11-02T10:00:00.000Z', 'by': {'email': 'hr@example.test'}, 'endingId': null, 'endingStatus': null},
      }),
    );
    expect(recorded.status, 'Recorded');
    expect(recorded.actions, isEmpty);
    expect(recorded.steps.last.text, ResignationWords.stepRecorded);
  });

  test('the letter is HR’s, never the employee’s to open (owner, 5 November 2026), whatever is sent', () {
    final d = resignationDetail(
      ResignationRequest.fromJson({
        ...resignationJson(),
        'preparedLetter': 'ready',
        'letter': {'letterFileName': 'signed.jpg', 'mimeType': 'image/jpeg', 'sizeBytes': 2048},
      }),
    );
    expect(d.opens, isNull);
    expect(d.facts.map((f) => f.value), isNot(contains('signed.jpg')));
  });
}
