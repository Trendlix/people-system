import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/assets/assets_words.dart';
import 'package:people/features/performance/performance_screen.dart';
import 'package:people/features/profile/profile_tab.dart';
import 'package:people/features/profile/profile_words.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'assets_test.dart' show custodyJson;
import 'profile_models_test.dart' show kpisJson, ownProfileJson, pendingRequestJson;

// The Profile tab (the phone design, 30 October 2026): who they are, the four tiles, Personal · Contact · Employment ·
// KPIs (the KPIs in place of Payroll: owner, 31 October 2026), their HR records with the company's assets they hold,
// and the account's rows; "Edit details" asks HR for a change (only what changed is sent);
// a request waiting can be cancelled; nothing People keeps from the employee is shown.

Future<void> openProfile(WidgetTester tester, FakePeople people) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.profile));
  await tester.pumpAndSettle();
}

Finder get profileList => find.descendant(of: find.byType(ProfileTab), matching: find.byType(Scrollable)).first;

/// Scrolls the Profile until it shows [finder] (upwards with [up]).
Future<void> scrollTo(WidgetTester tester, Finder finder, {bool up = false}) async {
  await tester.scrollUntilVisible(finder, up ? -200 : 200, scrollable: profileList);
  await tester.pumpAndSettle();
}

/// Presses Send to HR in the sheet, the keyboard put away first.
Future<void> tapSend(WidgetTester tester) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text(ChangeWords.send));
  await tester.pumpAndSettle();
  await tester.tap(find.text(ChangeWords.send));
  await tester.pumpAndSettle();
}

/// The switch's button with these words (the tiles have an "Employment" of their own).
Finder section(String label) => find.widgetWithText(InkWell, label);

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson(name: 'Mohamed Abdelrahman')))
      ..on('GET /api/employees/e1', (req) => json(ownProfileJson()))
      ..on('GET /api/kpis/scorecards/mine', (req) => json(kpisJson()))
      ..on('GET /api/me/custody', (req) => json(custodyJson()));
  });

  testWidgets('shows who they are, the four tiles and their personal details, nothing People keeps from them', (tester) async {
    await openProfile(tester, people);
    expect(find.text('Mohamed Abdelrahman', findRichText: true), findsWidgets);
    expect(find.text('EMPLOYEE PROFILE · TLX-055-25'), findsOneWidget);
    expect(find.text('Senior Product Designer · Product › Design'), findsOneWidget);
    expect(find.text('92%'), findsOneWidget);
    expect(find.text('Still missing: Military status certificate.'), findsOneWidget);
    expect(find.text('Yasmine Fahmy'), findsOneWidget);
    expect(find.text('Hybrid (office and home)'), findsOneWidget);
    expect(find.text('14 Feb 2024'), findsOneWidget);
    expect(find.text('Full-time'), findsOneWidget);

    await scrollTo(tester, find.text('Married'));
    expect(find.text('Mohamed'), findsOneWidget);
    expect(find.text('18 Apr 1993'), findsOneWidget);
    expect(find.text('Male'), findsOneWidget);
    expect(find.text('Egyptian'), findsOneWidget);
    await scrollTo(tester, find.text('Very good'));
    expect(find.text('Bachelor’s'), findsOneWidget);
    // no blood type in People, and the national ID is HR's and the CEO's
    expect(find.text('Blood type'), findsNothing);
    expect(find.text('National ID'), findsNothing);

    await scrollTo(tester, find.text(ProfileWords.employmentContract));
    expect(find.text('Signed · 12 Feb 2024'), findsOneWidget);
    expect(find.text('Military status certificate'), findsOneWidget);
    expect(find.text(ProfileWords.neededByHr), findsOneWidget);
    expect(find.text('Manage'), findsNothing);
  });

  testWidgets('switches to Contact, Employment and KPIs', (tester) async {
    await openProfile(tester, people);
    await scrollTo(tester, section(ProfileWords.contact));
    await tester.tap(section(ProfileWords.contact));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('+201012345678'));
    expect(find.text('m.abdelrahman@trendlix.example'), findsOneWidget);
    expect(find.text(ProfileWords.workEmailNote), findsOneWidget);
    await scrollTo(tester, find.text('Sara Ali'));
    expect(find.text('Wife'), findsOneWidget);

    await scrollTo(tester, section(ProfileWords.employment), up: true);
    await tester.tap(section(ProfileWords.employment));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Product › Design'));
    expect(find.text(ProfileWords.team), findsOneWidget);
    await scrollTo(tester, find.text('Fixed-term, until 13 Feb 2027'));
    expect(find.text('G5 · Senior'), findsOneWidget);
    expect(find.text('In the office on Sun, Tue'), findsOneWidget);
    expect(find.text('A · 09:00 – 18:00'), findsOneWidget);
    expect(find.text(ProfileWords.askToChange), findsNothing);

    await scrollTo(tester, section(ProfileWords.kpis), up: true);
    await tester.tap(section(ProfileWords.kpis));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('August 2026'));
    // the latest three: October's with the manager, then the final % and level of those signed off
    expect(find.text('October 2026'), findsOneWidget);
    expect(find.text('With the manager'), findsWidgets);
    expect(find.text('September 2026'), findsOneWidget);
    expect(find.text('104.5%'), findsOneWidget);
    expect(find.text('Above expectations'), findsOneWidget);
    expect(find.text('95%'), findsOneWidget);
    expect(find.text('July 2026'), findsNothing);
    // no payslips any more
    expect(find.textContaining('Payslip'), findsNothing);
    expect(people.calls, isNot(contains('GET /api/me/payslips')));

    // all of them on My performance, under the Profile
    await scrollTo(tester, find.text(ProfileWords.allScorecards(4)));
    await tester.tap(find.text(ProfileWords.allScorecards(4)));
    await tester.pumpAndSettle();
    expect(find.text(PerformanceScreen.title), findsOneWidget);
    expect(find.text('July 2026'), findsOneWidget);
  });

  testWidgets('says when there are no scorecards yet', (tester) async {
    people.on('GET /api/kpis/scorecards/mine', (req) => json([]));
    await openProfile(tester, people);
    await scrollTo(tester, section(ProfileWords.kpis));
    await tester.tap(section(ProfileWords.kpis));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text(ProfileWords.noKpis));
    expect(find.text(ProfileWords.openPerformance), findsNothing);
  });

  testWidgets('HR records show the company assets they hold, and open My Assets', (tester) async {
    await openProfile(tester, people);
    await scrollTo(tester, find.text(AssetsWords.companyAssets));
    expect(find.text(AssetsWords.withYou(2)), findsOneWidget);
    await tester.tap(find.text(AssetsWords.companyAssets));
    await tester.pumpAndSettle();
    expect(find.text(AssetsWords.title), findsOneWidget);
    expect(find.text('MacBook Pro 14'), findsOneWidget);
  });

  testWidgets('asks HR to change a detail: only what changed is sent, then the profile is read again', (tester) async {
    people.on('POST /api/employees/e1/change-requests', (req) => json(pendingRequestJson(), 201));
    await openProfile(tester, people);
    await scrollTo(tester, section(ProfileWords.contact));
    await tester.tap(section(ProfileWords.contact));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text(ProfileWords.askToChange));
    await tester.tap(find.text(ProfileWords.askToChange));
    await tester.pumpAndSettle();
    expect(find.text(ChangeWords.title), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, '+201012345678'), '+201099999999');
    final note = find.byType(TextField).last;
    await tester.ensureVisible(note);
    await tester.enterText(note, 'New number');
    await tapSend(tester);

    expect(people.bodyOf('POST /api/employees/e1/change-requests'), {
      'changes': {'mobile': '+201099999999'},
      'note': 'New number',
    });
    expect(find.text(ChangeWords.sent), findsOneWidget);
    expect(people.calls.where((c) => c == 'GET /api/employees/e1').length, greaterThanOrEqualTo(2));
  });

  testWidgets('sends nothing when nothing changed, and shows People’s refusal in its words', (tester) async {
    people.on('POST /api/employees/e1/change-requests', (req) => json({'message': 'Enter the mobile number with its country code, e.g. +201012345678.'}, 400));
    await openProfile(tester, people);
    await scrollTo(tester, find.text(ProfileWords.askToChange));
    await tester.tap(find.text(ProfileWords.askToChange));
    await tester.pumpAndSettle();
    await tapSend(tester);
    expect(find.text(ChangeWords.nothingChanged), findsOneWidget);
    expect(people.calls, isNot(contains('POST /api/employees/e1/change-requests')));

    await tester.ensureVisible(find.widgetWithText(TextField, 'Egyptian'));
    await tester.enterText(find.widgetWithText(TextField, 'Egyptian'), 'Egyptian, British');
    await tapSend(tester);
    expect(people.bodyOf('POST /api/employees/e1/change-requests')['changes'], {'nationality': 'Egyptian, British'});
    expect(find.text('Enter the mobile number with its country code, e.g. +201012345678.'), findsOneWidget);
    expect(find.text(ChangeWords.title), findsOneWidget);
  });

  testWidgets('shows the request waiting for HR, and cancels it', (tester) async {
    var cancelled = false;
    people
      ..on('GET /api/employees/e1', (req) => json(ownProfileJson(requests: cancelled ? [] : [pendingRequestJson()])))
      ..on('POST /api/change-requests/r1/cancel', (req) {
        cancelled = true;
        return json({...pendingRequestJson(), 'status': 'cancelled'});
      });
    await openProfile(tester, people);
    await scrollTo(tester, find.text(ProfileWords.cancelRequest));
    expect(find.text(ProfileWords.waitingSince('28 Oct 2026')), findsOneWidget);
    expect(find.text('Mobile: +201012345678 → +201099999999'), findsOneWidget);
    expect(find.text('Marital status: Single → Married'), findsOneWidget);
    expect(find.text(ProfileWords.askToChange), findsNothing);

    await tester.tap(find.text(ProfileWords.cancelRequest));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, ProfileWords.cancelRequest));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/change-requests/r1/cancel'));
    expect(find.text(ProfileWords.cancelled), findsOneWidget);
    await scrollTo(tester, find.text(ProfileWords.askToChange), up: true);
    expect(find.text(ProfileWords.askToChange), findsOneWidget);
  });

  testWidgets('opens the account’s screens from Security & preferences', (tester) async {
    await openProfile(tester, people);
    await scrollTo(tester, find.text(ProfileWords.changePassword));
    await tester.tap(find.text(ProfileWords.changePassword));
    await tester.pumpAndSettle();
    expect(find.text(AccountWords.passwordTitle), findsOneWidget);

    // the tab's button brings the Profile back
    await tester.tap(find.text(ShellWords.profile));
    await tester.pumpAndSettle();
    expect(find.text(AccountWords.passwordTitle), findsNothing);
    expect(find.text(ProfileWords.securityAndPreferences), findsOneWidget);
  });

  testWidgets('says what failed to load, with Try again', (tester) async {
    var fail = true;
    people.on('GET /api/employees/e1', (req) => fail ? json({'message': 'Employee not found.'}, 404) : json(ownProfileJson()));
    await openProfile(tester, people);
    expect(find.textContaining('Employee not found.'), findsOneWidget);
    fail = false;
    await tester.tap(find.text(ProfileWords.tryAgain));
    await tester.pumpAndSettle();
    expect(find.text('EMPLOYEE PROFILE · TLX-055-25'), findsOneWidget);
  });
}
