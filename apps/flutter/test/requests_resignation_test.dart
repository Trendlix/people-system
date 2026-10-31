import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/auth/session_store.dart';
import 'package:people/features/requests/kinds/resignation.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/requests_data.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/requests.dart';
import 'package:people/platform/file_opener.dart';
import 'package:people/providers.dart';
import 'package:people/theme/app_theme.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A resignation request from the phone (README Phase 2): offered only when People's form says so; the reason, the
// preferred last day and the box ticked, sent as JSON with no letter (owner, 31 October 2026: "on the resignation, the
// letter is auto generated, viewed by the employee but uploaded by the HR"); People's refusals in its words; the
// request's page with Withdraw until HR records it, and the letter People prepares and its signed copy, read with the
// session and opened in the phone's viewer.

/// The bytes People answers a letter with: a PDF's first line is enough here.
final pdf = Uint8List.fromList(utf8.encode('%PDF-1.4\n%%EOF\n'));

/// The phone's viewer in the tests: every file it was given, and whether it opens them.
class FakeOpener {
  FakeOpener({this.opens = true});

  bool opens;
  final opened = <(Uint8List, String, String)>[];

  Future<bool> call(Uint8List bytes, String name, String mimeType) async {
    opened.add((bytes, name, mimeType));
    return opens;
  }
}

/// A resignation request's page over the fakes, the phone's viewer replaced.
Future<void> openResignationPage(WidgetTester tester, FakePeople people, Map<String, Object?> json, FakeOpener opener) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept')),
        photoSourceProvider.overrideWithValue(FakePhotos()),
        fileOpenerProvider.overrideWithValue(opener.call),
      ],
      child: MaterialApp(
        theme: appTheme(Brightness.light),
        home: RequestPage(kind: RequestKind.resignation, id: '${json['id']}', initial: requestOf(RequestKind.resignation, json)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Scrolls the page down to [finder] and taps it.
Future<void> scrollToAndTap(WidgetTester tester, Finder finder) async {
  final page = find.descendant(of: find.byType(RequestPage), matching: find.byType(Scrollable)).first;
  await tester.scrollUntilVisible(finder, 300, scrollable: page);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sends a resignation once the box is ticked, with the notice the rule gives shown and no letter to attach', (tester) async {
    final people = requestsPeople()..on('POST /api/me/resignation', (req) => json(resignationJson(), 201));
    await openSheet(tester, people, showResignationSheet);
    expect(find.text(ResignationWords.noticeHint('3 months', '${y + 1}-01-29')), findsOneWidget);
    expect(find.text('The notice is 3 months by the resignation rule: sent today, it would end on 29/01/${y + 1}. A shorter time is for HR to agree.'), findsOneWidget);
    // People prepares the letter: nothing to photograph
    expect(find.text(ResignationWords.letterNote(false)), findsOneWidget);
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
    expect(find.text(ResignationWords.sent), findsOneWidget);
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
    expect(fact(ResignationWords.letterFact), ResignationWords.notUploaded);
    expect(d.steps.single.text, ResignationWords.stepSent);
    expect(d.actions.single.path, '/api/me/resignation/x1/withdraw');
    // an API from before the letter was prepared: nothing to open
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

  test('the letter: People’s to view once its template is set up, and the signed copy HR uploaded', () {
    final waiting = resignationDetail(ResignationRequest.fromJson({...resignationJson(), 'preparedLetter': 'no_template'})).opens!;
    expect(waiting.title, ResignationWords.letterTitle);
    expect(waiting.files, isEmpty);
    expect(waiting.notes, [ResignationWords.noTemplate, ResignationWords.signedNotYet(false)]);

    final ready = resignationDetail(
      ResignationRequest.fromJson({
        ...resignationJson(),
        'preparedLetter': 'ready',
        'letter': {'letterFileName': 'signed.jpg', 'mimeType': 'image/jpeg', 'sizeBytes': 2048},
      }),
    );
    expect(ready.facts.firstWhere((f) => f.label == ResignationWords.letterFact).value, 'signed.jpg');
    expect(ready.opens!.notes, isEmpty);
    expect(ready.opens!.files.map((f) => (f.button, f.path, f.fileName, f.mimeType)), [
      (ResignationWords.viewLetter, '/api/resignation-requests/x1/generated-letter', ResignationWords.letterFileName, 'application/pdf'),
      (ResignationWords.viewSigned, '/api/resignation-requests/x1/letter', 'signed.jpg', 'image/jpeg'),
    ]);
    // a C-level person's is the CEO's
    final ceo = resignationDetail(ResignationRequest.fromJson({...resignationJson(), 'preparedLetter': 'ready', 'confidential': true}));
    expect(ceo.opens!.explain, ResignationWords.letterExplain(true));
    expect(ceo.opens!.notes, [ResignationWords.signedNotYet(true)]);
  });

  testWidgets('View letter reads it with the session, never in a link, and opens it in the phone’s viewer', (tester) async {
    final people = requestsPeople()
      ..on('GET /api/resignation-requests/x1/generated-letter', (req) => http.Response.bytes(pdf, 200, headers: {'content-type': 'application/pdf'}));
    final opener = FakeOpener();
    await openResignationPage(tester, people, {...resignationJson(), 'preparedLetter': 'ready'}, opener);
    expect(find.text(ResignationWords.viewSigned), findsNothing);
    await scrollToAndTap(tester, find.widgetWithText(OutlinedButton, ResignationWords.viewLetter));

    final asked = lastSent(people, 'GET /api/resignation-requests/x1/generated-letter');
    expect(asked.headers['authorization'], 'Bearer kept');
    expect(asked.url.query, isEmpty);
    expect(opener.opened.single.$1, pdf);
    expect((opener.opened.single.$2, opener.opened.single.$3), (ResignationWords.letterFileName, 'application/pdf'));
    expect(find.text(ResignationWords.noViewer), findsNothing);
  });

  testWidgets('says People’s reason when the letter can’t be given, and when no app opens it', (tester) async {
    const noTemplate = 'HR hasn’t set up the resignation letter template yet.';
    final people = requestsPeople()
      ..on('GET /api/resignation-requests/x1/generated-letter', (req) => json({'statusCode': 409, 'message': noTemplate}, 409))
      ..on('GET /api/resignation-requests/x1/letter', (req) => http.Response.bytes(pdf, 200, headers: {'content-type': 'application/pdf'}));
    final opener = FakeOpener(opens: false);
    await openResignationPage(tester, people, {
      ...resignationJson(),
      'preparedLetter': 'ready',
      'letter': {'letterFileName': 'signed.pdf', 'mimeType': 'application/pdf', 'sizeBytes': 15},
    }, opener);

    await scrollToAndTap(tester, find.widgetWithText(OutlinedButton, ResignationWords.viewLetter));
    expect(opener.opened, isEmpty);
    final page = find.descendant(of: find.byType(RequestPage), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(find.text(noTemplate), -300, scrollable: page);
    expect(find.text(noTemplate), findsOneWidget);

    await scrollToAndTap(tester, find.widgetWithText(OutlinedButton, ResignationWords.viewSigned));
    expect(opener.opened.single.$2, 'signed.pdf');
    await tester.scrollUntilVisible(find.text(ResignationWords.noViewer), -300, scrollable: page);
    expect(find.text(ResignationWords.noViewer), findsOneWidget);
  });
}
