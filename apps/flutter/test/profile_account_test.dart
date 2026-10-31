import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/profile/profile_words.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'profile_models_test.dart' show calendarsJson, devicesJson, interviewHoursJson, ownProfileJson, sessionsJson;

// The account's screens (the phone design, 30 October 2026), opened from the More menu: Change Password (People's rule
// and refusals, this phone's fingerprint credential dropped once it changed), Profile Image (a new photo sent to HR:
// profile_photo_test.dart), Your Sessions (sign out of one, the phones' fingerprint sign-in, turning it on for this phone) and Your
// Interview Hours (read and saved as the website does).

Future<void> openAccount(WidgetTester tester, FakePeople people, String menuItem, {MemorySessionStore? store, FakeBiometrics? biometrics}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(
        people,
        store: store ?? MemorySessionStore(token: 'kept'),
        biometrics: biometrics,
      ),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.more));
  await tester.pumpAndSettle();
  await tester.tap(find.text(menuItem));
  await tester.pumpAndSettle();
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Finder field(String label) => find.descendant(
  of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
  matching: find.byType(TextField),
);

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson(name: 'Mohamed Abdelrahman')))
      ..on('GET /api/employees/e1', (req) => json(ownProfileJson()));
  });

  group('Change Password', () {
    testWidgets('changes it with People’s body, says so, and drops this phone’s fingerprint credential', (tester) async {
      people.on('POST /api/auth/change-password', (req) => json({}, 204));
      final store = MemorySessionStore(token: 'kept', device: (id: 'd1', secret: 'kept-secret', userId: 'u1'));
      await openAccount(tester, people, ShellWords.password, store: store);
      expect(find.text(AccountWords.passwordTitle), findsOneWidget);
      expect(find.text(AccountWords.rule), findsOneWidget);
      expect(find.text(AccountWords.guidanceTitle), findsOneWidget);

      await tester.enterText(field(AccountWords.current), 'old password here');
      await tester.enterText(field(AccountWords.fresh), 'a brand new sentence');
      await tester.enterText(field(AccountWords.confirm), 'a brand new sentence');
      await tapVisible(tester, find.text(AccountWords.changePassword));

      expect(people.bodyOf('POST /api/auth/change-password'), {'currentPassword': 'old password here', 'newPassword': 'a brand new sentence'});
      expect(find.text(AccountWords.changed), findsOneWidget);
      expect(store.device, isNull);
      expect(store.token, 'kept');
      expect(tester.widget<TextField>(field(AccountWords.fresh)).controller!.text, isEmpty);
    });

    testWidgets('sends nothing when the two new ones differ, and shows People’s refusal in its words', (tester) async {
      people.on('POST /api/auth/change-password', (req) => json({'message': 'Your current password is not correct.'}, 400));
      final store = MemorySessionStore(token: 'kept', device: (id: 'd1', secret: 'kept-secret', userId: 'u1'));
      await openAccount(tester, people, ShellWords.password, store: store);
      await tester.enterText(field(AccountWords.current), 'wrong one');
      await tester.enterText(field(AccountWords.fresh), 'a brand new sentence');
      await tester.enterText(field(AccountWords.confirm), 'a brand new sentense');
      await tapVisible(tester, find.text(AccountWords.changePassword));
      expect(find.text(AccountWords.noMatch), findsOneWidget);
      expect(people.calls, isNot(contains('POST /api/auth/change-password')));

      await tester.enterText(field(AccountWords.confirm), 'a brand new sentence');
      await tapVisible(tester, find.text(AccountWords.changePassword));
      expect(find.text('Your current password is not correct.'), findsOneWidget);
      expect(store.device, isNotNull);
    });

    testWidgets('shows and hides what was typed', (tester) async {
      await openAccount(tester, people, ShellWords.password);
      TextField current() => tester.widget<TextField>(field(AccountWords.current));
      expect(current().obscureText, isTrue);
      await tester.tap(find.byTooltip(AccountWords.show).first);
      await tester.pump();
      expect(current().obscureText, isFalse);
      await tester.tap(find.byTooltip(AccountWords.hide));
      await tester.pump();
      expect(current().obscureText, isTrue);
    });
  });

  // the employee sends HR a new photo (owner, 31 October 2026): profile_photo_test.dart
  testWidgets('Profile Image shows their initials without a photo on file, and the way to send HR one', (tester) async {
    await openAccount(tester, people, ShellWords.changePhoto);
    expect(find.text(AccountWords.photoTitle), findsOneWidget);
    expect(find.text(AccountWords.noPhotoYet), findsOneWidget);
    expect(find.text('MA'), findsWidgets);
    expect(find.text(AccountWords.newPhoto), findsOneWidget);
    expect(find.text(AccountWords.takePhoto), findsOneWidget);
    expect(find.text(AccountWords.choosePhoto), findsOneWidget);
    for (final tip in AccountWords.photoTips) {
      await tester.scrollUntilVisible(find.text(tip), 200, scrollable: find.byType(Scrollable).last);
      expect(find.text(tip), findsOneWidget);
    }
  });

  group('Your Sessions', () {
    setUp(() {
      people
        ..on('GET /api/auth/sessions', (req) => json(sessionsJson()))
        ..on('GET /api/auth/devices', (req) => json(devicesJson()));
    });

    testWidgets('lists the sessions and signs out of another one', (tester) async {
      var ended = false;
      people
        ..on('GET /api/auth/sessions', (req) => json(ended ? sessionsJson().take(1).toList() : sessionsJson()))
        ..on('POST /api/auth/sessions/s2/end', (req) {
          ended = true;
          return json({}, 204);
        });
      await openAccount(tester, people, ShellWords.devices);
      expect(find.text(AccountWords.sessionsTitle), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text(AccountWords.checkTheOthers), findsOneWidget);
      final list = find.byType(Scrollable).last;
      await tester.scrollUntilVisible(find.text('Chrome on Windows'), 200, scrollable: list);
      await tester.scrollUntilVisible(find.text('Trendlix People app on Android'), 200, scrollable: list);
      expect(find.text(AccountWords.thisDevice), findsOneWidget);

      await tester.scrollUntilVisible(find.text('Chrome on Windows'), -200, scrollable: list);
      await tapVisible(tester, find.bySemanticsLabel('${AccountWords.signOut}, Chrome on Windows'));
      expect(people.calls, contains('POST /api/auth/sessions/s2/end'));
      expect(find.text('Chrome on Windows'), findsNothing);
      await tester.scrollUntilVisible(find.text(AccountWords.onlyThisDevice), -200, scrollable: find.byType(Scrollable).last);
      expect(find.text(AccountWords.onlyThisDevice), findsOneWidget);
    });

    testWidgets('signing out of this phone’s own session signs the app out', (tester) async {
      people.on('POST /api/auth/logout', (req) => json({}, 204));
      await openAccount(tester, people, ShellWords.devices);
      await tester.scrollUntilVisible(find.text(AccountWords.thisDevice), 200, scrollable: find.byType(Scrollable).last);
      await tapVisible(tester, find.bySemanticsLabel('${AccountWords.signOut}, Trendlix People app on Android'));
      await tester.tap(find.widgetWithText(FilledButton, AccountWords.signOut));
      await tester.pumpAndSettle();
      expect(people.calls, contains('POST /api/auth/logout'));
      expect(find.text(SignInWords.subtitle), findsOneWidget);
    });

    testWidgets('marks this phone among the fingerprint phones, and signing it out forgets its credential', (tester) async {
      var revoked = false;
      people
        ..on('GET /api/auth/devices', (req) => json(revoked ? [] : devicesJson()))
        ..on('POST /api/auth/devices/d1/revoke', (req) {
          revoked = true;
          return json({}, 204);
        });
      final store = MemorySessionStore(token: 'kept', device: (id: 'd1', secret: 'kept-secret', userId: 'u1'));
      await openAccount(tester, people, ShellWords.devices, store: store);
      await tester.scrollUntilVisible(find.text(AccountWords.thisPhone), 200, scrollable: find.byType(Scrollable).last);
      expect(find.text('Google Pixel 8 · Android'), findsOneWidget);

      await tapVisible(tester, find.bySemanticsLabel('${AccountWords.signOut}, Google Pixel 8'));
      expect(people.calls, contains('POST /api/auth/devices/d1/revoke'));
      expect(store.device, isNull);
      expect(store.token, 'kept');
      expect(find.text(AccountWords.noPhone), findsOneWidget);
      expect(find.text(AccountWords.phoneSignedOut), findsOneWidget);
    });

    testWidgets('turns fingerprint sign-in on for this phone when it can and keeps none', (tester) async {
      var made = false;
      people
        ..on('GET /api/auth/devices', (req) => json(made ? devicesJson() : []))
        ..on('POST /api/auth/devices', (req) {
          made = true;
          return json({'id': 'd1', 'secret': 'new-secret'}, 201);
        });
      final store = MemorySessionStore(token: 'kept');
      final biometrics = FakeBiometrics(has: true);
      await openAccount(tester, people, ShellWords.devices, store: store, biometrics: biometrics);
      await tester.scrollUntilVisible(find.text(AccountWords.turnOn), 200, scrollable: find.byType(Scrollable).last);
      await tapVisible(tester, find.text(AccountWords.turnOn));
      expect(people.bodyOf('POST /api/auth/devices'), {'deviceName': 'Google Pixel 8', 'platform': 'android'});
      expect(store.device, (id: 'd1', secret: 'new-secret', userId: 'u1'));
      expect(find.text(AccountWords.turnedOn), findsOneWidget);
      expect(find.text(AccountWords.thisPhone), findsOneWidget);
      expect(find.text(AccountWords.turnOn), findsNothing);
    });
  });

  group('Your Interview Hours', () {
    setUp(() {
      people
        ..on('GET /api/me/interview-hours', (req) => json(interviewHoursJson()))
        ..on('GET /api/calendars/mine', (req) => json(calendarsJson()));
    });

    testWidgets('shows the week, the rules in effect, the calendar and what is to come', (tester) async {
      await openAccount(tester, people, ShellWords.hiring);
      expect(find.text(AccountWords.hoursTitle), findsOneWidget);
      expect(find.text(AccountWords.activeDays(2)), findsOneWidget);
      expect(find.text(AccountWords.inEffect('2 days’ notice · 15 minutes between interviews')), findsOneWidget);
      expect(find.text('10:00 AM – 12:00 PM'), findsOneWidget);
      final list = find.byType(Scrollable).last;
      await tester.scrollUntilVisible(find.text('27/10/2026'), 200, scrollable: list);
      expect(find.text('2 days'), findsOneWidget);
      expect(find.text('The company’s (15 minutes)'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('12 Nov 2026'), 200, scrollable: list);
      expect(find.text(AccountWords.dayOff), findsOneWidget);
      await tester.scrollUntilVisible(find.text(AccountWords.companyReads('Zoho Calendar')), 200, scrollable: list);
      await tester.scrollUntilVisible(find.text('Laila Hassan · UI Designer'), 200, scrollable: list);
    });

    testWidgets('saves the week as changed, and says People’s refusal in its words', (tester) async {
      var refuse = true;
      people.on('PUT /api/me/interview-hours', (req) {
        if (refuse) return json({'message': 'End Sunday’s range after it starts.'}, 400);
        return json(interviewHoursJson());
      });
      await openAccount(tester, people, ShellWords.hiring);
      await tapVisible(tester, find.byTooltip(AccountWords.removeRange('Monday', '1:00 PM – 3:00 PM')));
      expect(find.text(AccountWords.activeDays(1)), findsOneWidget);
      await tapVisible(tester, find.text(AccountWords.save));

      final sent = people.sent.lastWhere((r) => r.method == 'PUT');
      expect(sent.headers['authorization'], 'Bearer kept');
      expect(people.bodyOf('PUT /api/me/interview-hours'), {
        'windows': [
          {'day': 0, 'from': '10:00', 'to': '12:00'},
        ],
        'changes': [
          {'date': '2026-11-12', 'kind': 'off', 'from': null, 'to': null},
        ],
        'effectiveFrom': '2026-10-27',
        'noticeHours': 48,
        'bufferMinutes': null,
      });
      expect(find.text('End Sunday’s range after it starts.'), findsOneWidget);

      refuse = false;
      await tapVisible(tester, find.text(AccountWords.save));
      expect(find.text(AccountWords.saved), findsOneWidget);
    });

    testWidgets('asks for hours when none are set, and adds a range on the quarter hour', (tester) async {
      people
        ..on('GET /api/me/interview-hours', (req) => json(interviewHoursJson(none: true)))
        ..on('PUT /api/me/interview-hours', (req) => json(interviewHoursJson()));
      await openAccount(tester, people, ShellWords.hiring);
      expect(find.text(AccountWords.needsHours), findsOneWidget);
      expect(find.text(AccountWords.noneYet('24 hours’ notice · 15 minutes between interviews')), findsOneWidget);
      expect(find.text(AccountWords.noInterviews), findsNWidgets(7));

      await tapVisible(tester, find.bySemanticsLabel(AccountWords.addRangeOn('Tuesday')));
      expect(find.text(AccountWords.add), findsOneWidget);
      await tester.tap(find.text(ChangeWords.choose).first);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('9:00 AM'), 200, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('9:00 AM').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text(ChangeWords.choose).last);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('11:30 AM'), 200, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('11:30 AM').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text(AccountWords.add));
      await tester.pumpAndSettle();
      expect(find.text('9:00 AM – 11:30 AM'), findsOneWidget);

      await tapVisible(tester, find.text(AccountWords.save));
      final body = people.bodyOf('PUT /api/me/interview-hours');
      expect(body['windows'], [
        {'day': 2, 'from': '09:00', 'to': '11:30'},
      ]);
      expect((body['noticeHours'], body['bufferMinutes']), (null, null));
      expect(body['changes'], isEmpty);
    });
  });
}
