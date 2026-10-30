import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/features/requests/kinds/resignation.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A resignation request from the phone (README Phase 2): offered only when People's form says so; the reason, the
// preferred last day, a photo of the signed letter and the box ticked, sent as People's form takes them (multipart,
// "letter"); People's refusals in its words; the request's page with Withdraw until HR records it.

/// A multipart body read as text even with a photo's bytes in it (the fixtures' parsers read `body`).
http.Request readable(http.Request r) => http.Request(r.method, r.url)..body = utf8.decode(r.bodyBytes, allowMalformed: true);

void main() {
  testWidgets('sends a resignation once the box is ticked, with the notice the rule gives shown', (tester) async {
    final people = requestsPeople()..on('POST /api/me/resignation', (req) => json(resignationJson(), 201));
    await openSheet(tester, people, showResignationSheet);
    expect(find.text(ResignationWords.noticeHint('3 months', '${y + 1}-01-29')), findsOneWidget);
    expect(find.text('The notice is 3 months by the resignation rule: sent today, it would end on 29/01/${y + 1}. A shorter time is for HR to agree.'), findsOneWidget);

    await typeInto(tester, ResignationWords.reason, 'Moving abroad.');
    expect(find.text(ResignationWords.tick), findsOneWidget);
    await scrollAndTap(tester, find.text(ResignationWords.send));
    expect(people.calls, isNot(contains('POST /api/me/resignation')));

    await scrollAndTap(tester, find.byType(Switch));
    expect(find.text(ResignationWords.tick), findsNothing);
    await scrollAndTap(tester, find.text(ResignationWords.send));

    final sent = readable(lastSent(people, 'POST /api/me/resignation'));
    expect(formFields(sent), {'reason': 'Moving abroad.', 'preferredLastDay': '', 'confirmed': 'true'});
    expect(formFiles(sent), isEmpty);
    expect(find.text(ResignationWords.pageTitle), findsOneWidget);
    expect(find.text(ResignationWords.sent), findsOneWidget);
  });

  testWidgets('sends the signed letter’s photo, and says People’s refusal in its words', (tester) async {
    const refusal = 'You already have a resignation request waiting for HR. Withdraw it first to send another.';
    final people = requestsPeople()..on('POST /api/me/resignation', (req) => json({'statusCode': 409, 'message': refusal}, 409));
    await openSheet(tester, people, showResignationSheet, photos: FakePhotos('letter.jpg'));
    await typeInto(tester, ResignationWords.reason, 'Moving abroad.');
    await scrollAndTap(tester, find.text(RequestsWords.takePhoto));
    expect(find.text(RequestsWords.takePhoto), findsNothing);
    await scrollAndTap(tester, find.byType(Switch));
    await scrollAndTap(tester, find.text(ResignationWords.send));

    final sent = readable(lastSent(people, 'POST /api/me/resignation'));
    expect(formFiles(sent), [('letter', 'letter.jpg')]);
    expect(formFields(sent)['confirmed'], 'true');
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
    expect(fact(ResignationWords.letterFact), ResignationWords.noneAttached);
    expect(d.steps.single.text, ResignationWords.stepSent);
    expect(d.actions.single.path, '/api/me/resignation/x1/withdraw');

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
}
