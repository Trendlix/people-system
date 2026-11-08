import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/requests/approvals.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/requests_data.dart';
import 'package:people/models/requests.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/theme/look.dart';
import 'package:people/theme/tokens.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// To approve in the app (owner, 4 November 2026: "For roles who approve requests, why there is no approve button in the
// app?"; asked, "Now: everyday requests"): what waits for the person's step at the top of the Requests tab, approved in
// one tap, rejected with why, Approve all; the request's page with the same two buttons.

Map<String, Object?> waitingLeave(String id, String created) => {...leaveJson(id: id, status: 'with_manager', createdAt: created), 'waitingForYou': true};

void main() {
  late FakePeople people;

  setUp(() => people = requestsPeople());

  test('reads each everyday kind’s waiting list', () {
    expect(waitingPath(RequestKind.leave), '/api/leave/requests?status=waiting');
    expect(waitingPath(RequestKind.permission), '/api/leave/permissions?status=waiting');
    expect(waitingPath(RequestKind.correction), '/api/attendance/corrections?status=waiting');
    expect(waitingPath(RequestKind.wfh), '/api/wfh?status=waiting');
    expect(waitingPath(RequestKind.od), '/api/official-duty?status=waiting');
    expect(waitingPath(RequestKind.compensatory), '/api/compensatory?status=waiting');
    expect(waitingPath(RequestKind.claim), '/api/reimbursements?status=waiting');
    expect(approvableKinds, isNot(contains(RequestKind.home)));
  });

  testWidgets('shows nothing when nothing waits for them', (tester) async {
    await openRequestsTab(tester, people);
    expect(find.text(ApproveWords.title), findsNothing);
  });

  testWidgets('approves in one tap, rejects with why, approves the rest together', (tester) async {
    var waiting = [waitingLeave('w1', '$y-10-20T08:00:00.000Z'), waitingLeave('w2', '$y-10-21T08:00:00.000Z'), waitingLeave('w3', '$y-10-22T08:00:00.000Z')];
    people
      ..on('GET /api/leave/requests', (req) => json(waiting))
      ..on('POST /api/leave/requests/w1/decide', (req) {
        waiting = waiting.where((r) => r['id'] != 'w1').toList();
        return json(leaveJson(id: 'w1', status: 'with_hr'));
      })
      ..on('POST /api/leave/requests/w2/decide', (req) {
        waiting = waiting.where((r) => r['id'] != 'w2').toList();
        return json(leaveJson(id: 'w2', status: 'rejected'));
      });
    await openRequestsTab(tester, people);
    expect(find.text(ApproveWords.title), findsOneWidget);
    expect(find.text(ApproveWords.count(3)), findsOneWidget);
    expect(find.text(ApproveWords.approveAll(3)), findsOneWidget);

    // the oldest first: approved in one tap
    await tester.tap(find.byTooltip(ApproveWords.approve).first);
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/leave/requests/w1/decide'), {'decision': 'approve'});
    expect(find.text(ApproveWords.count(2)), findsOneWidget);

    // rejected only with why
    await tester.tap(find.byTooltip(ApproveWords.reject).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, ApproveWords.reject));
    await tester.pumpAndSettle();
    expect(find.text(ApproveWords.whyNeeded), findsOneWidget);
    expect(people.calls, isNot(contains('POST /api/leave/requests/w2/decide')));
    await tester.enterText(find.byType(TextField), '  The team is short that week ');
    await tester.tap(find.widgetWithText(FilledButton, ApproveWords.reject));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/leave/requests/w2/decide'), {'decision': 'reject', 'comment': 'The team is short that week'});
    expect(find.text(ApproveWords.count(1)), findsOneWidget);
    // one left: no Approve all
    expect(find.textContaining('Approve all'), findsNothing);
  });

  testWidgets('says People’s refusal in its words', (tester) async {
    people
      ..on('GET /api/leave/permissions', (req) => json([{...permissionJson(id: 'p1', status: 'with_manager'), 'waitingForYou': true}]))
      ..on('POST /api/leave/permissions/p1/decide', (req) => json({'message': 'It has moved on: the HR step decides it now.'}, 409));
    await openRequestsTab(tester, people);
    await tester.tap(find.byTooltip(ApproveWords.approve));
    await tester.pumpAndSettle();
    expect(find.text('It has moved on: the HR step decides it now.'), findsOneWidget);
  });

  testWidgets('decides it on its page too', (tester) async {
    people
      ..on('GET /api/leave/requests', (req) => json([waitingLeave('w1', '$y-10-20T08:00:00.000Z')]))
      ..on('POST /api/leave/requests/w1/decide', (req) => json(leaveJson(id: 'w1', status: 'with_hr')));
    await openRequestsTab(tester, people);
    // the row opens its page (whose it is, as the card names it)
    await tester.tap(find.descendant(of: find.byType(ToApproveCard), matching: find.text('Hazem Soliman')));
    await tester.pumpAndSettle();
    expect(find.byType(RequestPage), findsOneWidget);
    // the page is built as it scrolls
    await tester.scrollUntilVisible(find.text(ApproveWords.decideTitle), 300, scrollable: find.descendant(of: find.byType(RequestPage), matching: find.byType(Scrollable)).first);
    expect(find.text(ApproveWords.decideTitle), findsOneWidget);
    await tester.ensureVisible(find.widgetWithText(FilledButton, ApproveWords.approve));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, ApproveWords.approve));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/leave/requests/w1/decide'), {'decision': 'approve'});
    // decided: no longer waiting for them
    expect(find.text(ApproveWords.decideTitle), findsNothing);
  });

  // the tick was the theme's ink on the black circle, so it didn't show (8 November 2026)
  for (final dark in [false, true]) {
    testWidgets('draws the Approve tick in the button’s own colour, ${dark ? 'dark' : 'light'}', (tester) async {
      people.on('GET /api/leave/requests', (req) => json([waitingLeave('w1', '$y-10-20T08:00:00.000Z')]));
      phoneScreen(tester);
      await tester.pumpWidget(
        ProviderScope(
          retry: noRetry,
          overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), look: MemoryLookStore(dark ? ThemeMode.dark : ThemeMode.light)),
          child: const PeopleApp(),
        ),
      );
      await tester.pumpAndSettle();
      await putOffWaiting(tester);
      await tester.tap(find.text(ShellWords.requests));
      await tester.pumpAndSettle();
      final look = dark ? Palette.dark : Palette.light;
      final tick = tester.widget<Icon>(find.descendant(of: find.byTooltip(ApproveWords.approve), matching: find.byIcon(CupertinoIcons.checkmark)));
      expect(tick.color, look.onPrimary);
      expect(tick.color, isNot(look.primary));
    });
  }
}
