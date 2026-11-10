import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/waiting_popup.dart';
import 'package:people/models/requests.dart';
import 'package:people/notifications/places.dart';
import 'package:people/notifications/popup_memory.dart';
import 'package:people/notifications/push_center.dart';
import 'package:people/platform/push.dart';
import 'package:people/platform/update_gate.dart' show linkOpenerProvider;
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// Notifications on the phone (owner, 8 November 2026: "notifications are not working correctly, and when there is a
// pending request make it to popup in the mobile app and gives a push notification once requested"; "opened
// notifications should be marked read"): the phone registered for People's pushes, what waits for them in a popup, a
// notification opened on its screen and marked read.

/// The phone's push, as each test sets it.
class FakePush implements Push {
  FakePush({this.permission = PushPermission.allowed, this.tokenNow = 'tok-1', this.launched});

  PushPermission permission;
  String? tokenNow;
  PushMessage? launched;
  var asked = 0;
  var forgot = 0;
  final changes = StreamController<String>.broadcast();
  final receivedNow = StreamController<PushMessage>.broadcast();
  final openedNow = StreamController<PushMessage>.broadcast();

  @override
  bool get available => true;

  @override
  String get platform => 'android';

  @override
  Future<bool> start() async => true;

  @override
  Future<PushPermission> ask() async {
    asked++;
    return permission;
  }

  @override
  Future<String?> token() async => tokenNow;

  @override
  Stream<String> get tokenChanges => changes.stream;

  @override
  Stream<PushMessage> get received => receivedNow.stream;

  @override
  Stream<PushMessage> get opened => openedNow.stream;

  @override
  Future<PushMessage?> launchedWith() async {
    final m = launched;
    launched = null;
    return m;
  }

  @override
  Future<void> forget() async => forgot++;
}

http.Response http204() => http.Response('', 204);

Map<String, Object?> waitingLeave(String id, String created, {String name = 'Omar Staff'}) => {
  ...leaveJson(id: id, status: 'with_manager', createdAt: created, start: '$y-11-10', end: '$y-11-12'),
  'employee': {...employeeJson(), 'id': 'e5', 'fullNameEn': name},
  'waitingForYou': true,
};

Map<String, Object?> inboxRow(String id, {String kind = 'leave_decided', String title = 'Your leave was approved', String? link = '/leave/l9', bool read = false}) => {
  'id': id,
  'kind': kind,
  'title': title,
  'body': '10–12 November',
  'link': link,
  'readAt': read ? '$y-11-08T08:00:00.000Z' : null,
  'createdAt': '$y-11-08T07:00:00.000Z',
};

/// The links opened in the phone's browser, as each test reads them.
final browsed = <Uri>[];

Future<void> openWith(WidgetTester tester, FakePeople people, {Push? push, MemoryPopupMemory? popup}) async {
  phoneScreen(tester);
  browsed.clear();
  await tester.pumpWidget(
    // a new app each time (the same scope would be kept, and the app not opened again)
    ProviderScope(
      key: UniqueKey(),
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept'), popup: popup),
        pushProvider.overrideWithValue(push ?? const NoPush()),
        linkOpenerProvider.overrideWithValue((uri) async {
          browsed.add(uri);
          return true;
        }),
      ],
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('where a notification opens', () {
    test('a request’s page, by its kind', () {
      expect(placeOf('/leave/l1', 'leave_waiting'), const RequestPlace(RequestKind.leave, 'l1'));
      expect(placeOf('/leave/permissions/p1', 'permission_decided'), const RequestPlace(RequestKind.permission, 'p1'));
      expect(placeOf('/attendance/corrections/c1', 'correction_waiting'), const RequestPlace(RequestKind.correction, 'c1'));
      expect(placeOf('/attendance/wfh/w1', 'wfh_waiting'), const RequestPlace(RequestKind.wfh, 'w1'));
      expect(placeOf('/attendance/official-duty/o1', 'od_decided'), const RequestPlace(RequestKind.od, 'o1'));
      expect(placeOf('/attendance/compensatory/k1', 'compensatory_waiting'), const RequestPlace(RequestKind.compensatory, 'k1'));
      expect(placeOf('/reimbursements/r1', 'reimbursement_paid'), const RequestPlace(RequestKind.claim, 'r1'));
      expect(placeOf('/home-locations/h1', 'home_location_decided'), const RequestPlace(RequestKind.home, 'h1'));
      expect(placeOf('/resignations/s1', 'resignation_update'), const RequestPlace(RequestKind.resignation, 's1'));
    });

    test('a week of hours, the scorecards, a tab', () {
      expect(placeOf('/timesheets/t1', 'timesheet_waiting'), const WeekPlace('t1'));
      expect(placeOf('/kpis/team', 'kpi_waiting'), const ScreenPlace('/dashboard/performance/team'));
      expect(placeOf('/kpis/scorecards/k1', 'kpi_ready_to_sign'), const ScreenPlace('/dashboard/performance'));
      expect(placeOf('/approvals', 'stand_in'), const ScreenPlace('/requests'));
      expect(placeOf('/leave?status=waiting', 'stand_in'), const ScreenPlace('/requests'));
      expect(placeOf('/my-requests#covering', 'leave_cover'), const ScreenPlace('/requests'));
      expect(placeOf('/my-attendance', 'check_in_reminder'), const ScreenPlace('/attendance'));
      expect(placeOf('', 'check_in_reminder'), const ScreenPlace('/dashboard'));
      expect(placeOf('/my-custody', 'custody_handover'), const ScreenPlace('/profile/assets'));
    });

    // owner, 10 November 2026, of a vacancy to approve: "i couldn't do it from the app"; "you can open it in a browser"
    test('the website for what the app has no screen for; nowhere without a link', () {
      expect(placeOf('/recruitment/vacancies/v1', 'vacancy_waiting'), WebsitePlace(Uri.parse('https://people.trendlix.com/recruitment/vacancies/v1')));
      expect(placeOf('/my-hiring', 'shortlist_review'), WebsitePlace(Uri.parse('https://people.trendlix.com/my-hiring')));
      expect(placeOf('/app/payslips/l1', 'payslip_issued'), WebsitePlace(Uri.parse('https://people.trendlix.com/app/payslips/l1')));
      expect(placeOf('/raise-requests?status=with_hr', 'raise_request_waiting'), WebsitePlace(Uri.parse('https://people.trendlix.com/raise-requests?status=with_hr')));
      expect(placeOf('/leave/permissions', 'permission_waiting'), const ScreenPlace('/requests'));
      expect(placeOf('', 'hr_message'), isNull);
      // never another site's
      expect(placeOf('//evil.test/x', 'hr_message'), isNull);
      expect(placeOf('https://evil.test/x', 'hr_message'), isNull);
    });
  });

  test('reads a push as People sends it', () {
    final m = PushMessage.of({'id': 'n1', 'kind': 'leave_waiting', 'link': '/leave/l1'}, title: 'Leave waiting', body: 'Omar · 10–12 Nov');
    expect((m.id, m.kind, m.link, m.title, m.body), ('n1', 'leave_waiting', '/leave/l1', 'Leave waiting', 'Omar · 10–12 Nov'));
    expect(PushMessage.of({}).id, '');
  });

  test('push in a build only with Firebase’s settings for its phone', () {
    expect(const FirebaseSettings().readyOn(TargetPlatform.android), isFalse);
    expect(const FirebaseSettings(android: true).readyOn(TargetPlatform.android), isTrue);
    expect(const FirebaseSettings(android: true).readyOn(TargetPlatform.iOS), isFalse);
    expect(const FirebaseSettings(apiKey: 'k', appId: 'a', senderId: 's', projectId: 'p').readyOn(TargetPlatform.iOS), isTrue);
    expect(const FirebaseSettings(apiKey: 'k', appId: 'a', senderId: 's').readyOn(TargetPlatform.iOS), isFalse);
  });

  group('when the waiting popup shows', () {
    const today = '2026-11-08';
    test('a new request at once; the same ones again only the next day', () {
      expect(waitingPopupDue(waiting: {}, last: null, userId: 'u1', today: today), isFalse);
      expect(waitingPopupDue(waiting: {'leave:a'}, last: null, userId: 'u1', today: today), isTrue);
      final shown = (userId: 'u1', day: today, keys: {'leave:a', 'leave:b'});
      expect(waitingPopupDue(waiting: {'leave:a'}, last: shown, userId: 'u1', today: today), isFalse);
      expect(waitingPopupDue(waiting: {'leave:a', 'leave:c'}, last: shown, userId: 'u1', today: today), isTrue);
      expect(waitingPopupDue(waiting: {'leave:a'}, last: shown, userId: 'u1', today: '2026-11-09'), isTrue);
      expect(waitingPopupDue(waiting: {'leave:a'}, last: shown, userId: 'u2', today: today), isTrue);
    });

    test('kept as JSON; unreadable as none', () {
      final kept = popupShownOf('{"userId":"u1","day":"2026-11-08","keys":["leave:a"]}')!;
      expect((kept.userId, kept.day), ('u1', '2026-11-08'));
      expect(kept.keys, {'leave:a'});
      expect(popupShownOf('nope'), isNull);
      expect(popupShownOf(null), isNull);
      expect(popupDay(DateTime(2026, 3, 4, 23, 59)), '2026-03-04');
    });
  });

  group('the waiting popup', () {
    late FakePeople people;
    setUp(() => people = requestsPeople());

    testWidgets('pops up as the app opens; Later; not again for the same; again for a new one', (tester) async {
      var waiting = [waitingLeave('w1', '$y-11-01T08:00:00.000Z'), waitingLeave('w2', '$y-11-02T08:00:00.000Z', name: 'Mona Adel')];
      people.on('GET /api/leave/requests', (req) => json(waiting));
      final memory = MemoryPopupMemory();
      await openWith(tester, people, popup: memory);
      expect(find.text(WaitingWords.title(2)), findsOneWidget);
      expect(find.text('Omar Staff'), findsOneWidget);
      expect(find.text('Mona Adel'), findsOneWidget);
      await tester.tap(find.text(WaitingWords.later));
      await tester.pumpAndSettle();
      expect(find.text(WaitingWords.title(2)), findsNothing);
      expect(memory.shown?.keys, {'leave:w1', 'leave:w2'});

      // opened again the same day: not again
      await openWith(tester, people, popup: memory);
      expect(find.text(WaitingWords.title(2)), findsNothing);

      // a new one sent: again, with all three
      waiting = [...waiting, waitingLeave('w3', '$y-11-03T08:00:00.000Z', name: 'Ali Hassan')];
      await openWith(tester, people, popup: memory);
      expect(find.text(WaitingWords.title(3)), findsOneWidget);
    });

    testWidgets('Review opens the one request', (tester) async {
      people
        ..on('GET /api/leave/requests', (req) => json([waitingLeave('w1', '$y-11-01T08:00:00.000Z')]))
        ..on('GET /api/leave/requests/w1', (req) => json(waitingLeave('w1', '$y-11-01T08:00:00.000Z')));
      await openWith(tester, people);
      expect(find.text(WaitingWords.title(1)), findsOneWidget);
      await tester.tap(find.text(WaitingWords.review));
      await tester.pumpAndSettle();
      expect(find.byType(RequestPage), findsOneWidget);
    });

    testWidgets('nothing waiting: no popup', (tester) async {
      await openWith(tester, people);
      expect(find.byType(AlertDialog), findsNothing);
    });
  });

  group('the bell’s list', () {
    late FakePeople people;
    setUp(() {
      people = requestsPeople()
        ..on('GET /api/me/notifications/unread-count', (req) => json({'unread': 2}))
        ..on(
          'GET /api/me/notifications',
          (req) => json({
            'items': [
              inboxRow('n1'),
              inboxRow('n2', kind: 'vacancy_waiting', title: 'A vacancy waits for your approval', link: '/recruitment/vacancies/v1'),
              inboxRow('n3', kind: 'hr_message', title: 'A word from HR', link: null),
            ],
            'unread': 2,
          }),
        )
        ..on('POST /api/me/notifications/n1/read', (req) => http204())
        ..on('POST /api/me/notifications/n2/read', (req) => http204())
        ..on('POST /api/me/notifications/n3/read', (req) => http204())
        ..on('GET /api/leave/requests/l9', (req) => json(leaveJson(id: 'l9', status: 'approved')));
    });

    testWidgets('a notification opened: marked read, its request’s page', (tester) async {
      await openWith(tester, people);
      await tester.tap(find.byTooltip(ShellWords.unread(2)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Your leave was approved'));
      await tester.pumpAndSettle();
      expect(people.calls, contains('POST /api/me/notifications/n1/read'));
      expect(find.byType(RequestPage), findsOneWidget);
    });

    testWidgets('one with no screen in the app: marked read, its page on the website in the browser', (tester) async {
      await openWith(tester, people);
      await tester.tap(find.byTooltip(ShellWords.unread(2)));
      await tester.pumpAndSettle();
      // marked with an arrow out, the others with a chevron
      expect(find.byIcon(CupertinoIcons.arrow_up_right_square), findsOneWidget);
      await tester.tap(find.text('A vacancy waits for your approval'));
      await tester.pumpAndSettle();
      expect(people.calls, contains('POST /api/me/notifications/n2/read'));
      expect(browsed, [Uri.parse('https://people.trendlix.com/recruitment/vacancies/v1')]);
      expect(find.byType(RequestPage), findsNothing);
    });

    testWidgets('one without a link: marked read where it is', (tester) async {
      await openWith(tester, people);
      await tester.tap(find.byTooltip(ShellWords.unread(2)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('A word from HR'));
      await tester.pumpAndSettle();
      expect(people.calls, contains('POST /api/me/notifications/n3/read'));
      expect(find.text('A word from HR'), findsOneWidget);
      expect(browsed, isEmpty);
    });
  });

  group('push', () {
    late FakePeople people;
    setUp(() {
      people = requestsPeople()
        ..on('POST /api/me/push-devices', (req) => http204())
        ..on('POST /api/me/push-devices/unregister', (req) => http204())
        ..on('POST /api/auth/logout', (req) => http204())
        ..on('POST /api/me/notifications/n7/read', (req) => http204())
        ..on('GET /api/leave/requests/l7', (req) => json(leaveJson(id: 'l7', status: 'approved')));
    });

    testWidgets('signed in: the phone asked, its token given to People, again when it changes', (tester) async {
      final push = FakePush();
      await openWith(tester, people, push: push);
      expect(push.asked, 1);
      expect(people.bodyOf('POST /api/me/push-devices'), {'token': 'tok-1', 'platform': 'android'});
      final c = ProviderScope.containerOf(tester.element(find.byType(Scaffold).first));
      expect(c.read(pushStateProvider), PushState.on);
      push.changes.add('tok-2');
      await tester.pumpAndSettle();
      expect(people.bodyOf('POST /api/me/push-devices'), {'token': 'tok-2', 'platform': 'android'});
    });

    testWidgets('not allowed on the phone: People isn’t given a token', (tester) async {
      final push = FakePush(permission: PushPermission.denied);
      await openWith(tester, people, push: push);
      expect(people.calls, isNot(contains('POST /api/me/push-devices')));
      final c = ProviderScope.containerOf(tester.element(find.byType(Scaffold).first));
      expect(c.read(pushStateProvider), PushState.notAllowed);
    });

    testWidgets('signing out: People forgets the phone before the session ends', (tester) async {
      final push = FakePush();
      await openWith(tester, people, push: push);
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      await tester.tap(find.text(ShellWords.signOut));
      await tester.pumpAndSettle();
      final calls = people.calls;
      expect(people.bodyOf('POST /api/me/push-devices/unregister'), {'token': 'tok-1'});
      expect(calls.indexOf('POST /api/me/push-devices/unregister'), lessThan(calls.indexOf('POST /api/auth/logout')));
      expect(push.forgot, 1);
    });

    testWidgets('one tapped on the phone: its page, marked read', (tester) async {
      final push = FakePush();
      await openWith(tester, people, push: push);
      push.openedNow.add(const PushMessage(id: 'n7', kind: 'leave_decided', link: '/leave/l7', title: 'Your leave was approved', body: ''));
      await tester.pumpAndSettle();
      expect(find.byType(RequestPage), findsOneWidget);
      expect(people.calls, contains('POST /api/me/notifications/n7/read'));
    });

    testWidgets('one tapped with no screen in the app: its page on the website', (tester) async {
      final push = FakePush();
      await openWith(tester, people, push: push);
      push.openedNow.add(const PushMessage(id: 'n9', kind: 'vacancy_waiting', link: '/recruitment/vacancies/v1', title: 'A vacancy waits for your approval', body: ''));
      await tester.pumpAndSettle();
      expect(browsed, [Uri.parse('https://people.trendlix.com/recruitment/vacancies/v1')]);
      expect(people.calls, contains('POST /api/me/notifications/n9/read'));
    });

    testWidgets('the one that opened the app: its page first, no popup over it', (tester) async {
      people
        ..on('GET /api/leave/requests', (req) => json([waitingLeave('w1', '$y-11-01T08:00:00.000Z')]))
        ..on('GET /api/leave/requests/l7', (req) => json(waitingLeave('l7', '$y-11-01T08:00:00.000Z')));
      final push = FakePush(launched: const PushMessage(id: 'n7', kind: 'leave_waiting', link: '/leave/l7', title: 'Leave waiting', body: ''));
      await openWith(tester, people, push: push);
      expect(find.byType(RequestPage), findsOneWidget);
      expect(find.text(WaitingWords.title(1)), findsNothing);
      expect(people.calls, contains('POST /api/me/notifications/n7/read'));
    });

    testWidgets('a new request while the app is open: the popup at once', (tester) async {
      var waiting = <Map<String, Object?>>[];
      people.on('GET /api/leave/requests', (req) => json(waiting));
      final push = FakePush();
      await openWith(tester, people, push: push);
      expect(find.byType(AlertDialog), findsNothing);
      waiting = [waitingLeave('w1', '$y-11-08T08:00:00.000Z')];
      push.receivedNow.add(const PushMessage(id: 'n8', kind: 'leave_waiting', link: '/leave/w1', title: 'Leave waiting for you', body: 'Omar Staff'));
      await tester.pumpAndSettle();
      expect(find.text(WaitingWords.title(1)), findsOneWidget);
    });

    testWidgets('anything else while the app is open: a message with Open', (tester) async {
      final push = FakePush();
      await openWith(tester, people, push: push);
      push.receivedNow.add(const PushMessage(id: 'n7', kind: 'leave_decided', link: '/leave/l7', title: 'Your leave was approved', body: '10–12 November'));
      // the message slides in
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Your leave was approved\n10–12 November'), findsOneWidget);
      await tester.tap(find.text(ShellWords.open));
      await tester.pumpAndSettle();
      expect(find.byType(RequestPage), findsOneWidget);
      expect(people.calls, contains('POST /api/me/notifications/n7/read'));
    });
  });
}
