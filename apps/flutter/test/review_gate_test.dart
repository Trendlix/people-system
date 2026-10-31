import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/profile/profile_words.dart';
import 'package:people/features/review/review_screen.dart';
import 'package:people/features/review/review_words.dart';
import 'package:people/models/profile.dart';
import 'package:people/models/review.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'profile_models_test.dart' show kpisJson, ownProfileJson, pendingRequestJson;

// Review your details at sign-in (owner, 31 October 2026: "make the data review obligatory upon the signin for
// employees"): while their details aren't confirmed as they are now and no change they asked for waits, the app shows
// only the review (the details in the website's parts, the statement, Confirm, Ask for a change, Sign out); confirming
// or asking for a change lets them in. A change waiting lets them through, and they may still confirm from the Profile.

const never = {'confirmedAt': null, 'confirmedBy': null, 'upToDate': false, 'changedFields': <String>[], 'disclaimerVersion': null};
const confirmed = {'confirmedAt': '2026-10-01T09:00:00.000Z', 'confirmedBy': null, 'upToDate': true, 'changedFields': <String>[], 'disclaimerVersion': 1};
const changedMobile = {'confirmedAt': '2026-10-01T09:00:00.000Z', 'confirmedBy': null, 'upToDate': false, 'changedFields': ['mobile'], 'disclaimerVersion': 1};

Map<String, Object?> profileWith(Map<String, Object?> confirmation, {List<Map<String, Object?>> requests = const []}) => {
  ...ownProfileJson(requests: requests),
  'confirmation': confirmation,
};

Future<void> openApp(WidgetTester tester, FakePeople people) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

Finder get reviewList => find.descendant(of: find.byType(ReviewScreen), matching: find.byType(Scrollable)).first;

Future<void> scrollToFind(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 300, scrollable: reviewList);
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;
  late Map<String, Object?> profile;

  setUp(() {
    profile = profileWith(never);
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson(name: 'Mohamed Abdelrahman')))
      ..on('GET /api/employees/e1', (req) => json(profile))
      ..on('GET /api/kpis/scorecards/mine', (req) => json(kpisJson()))
      ..on('POST /api/auth/logout', (req) => json({'ok': true}));
  });

  test('asks for the review until confirmed as now, or while no change they asked for waits', () {
    expect(OwnProfile.fromJson(profileWith(never)).mustReview, isTrue);
    expect(OwnProfile.fromJson(profileWith(changedMobile)).mustReview, isTrue);
    expect(OwnProfile.fromJson(profileWith(confirmed)).mustReview, isFalse);
    expect(OwnProfile.fromJson(profileWith(never, requests: [pendingRequestJson()])).mustReview, isFalse);
    // an API from before confirmations holds nobody back
    expect(OwnProfile.fromJson({...ownProfileJson(), 'confirmation': null}).mustReview, isFalse);
    expect(reviewReason(Confirmation.fromJson(changedMobile)), ReviewWords.changed('Mobile'));
    expect(ConfirmFields.namesOf(['emergencyMobile', 'city']), 'Emergency contact mobile, City');
    // shown as the website shows them
    final p = profileWith(never);
    String? shown(String key) => confirmValueOf(ConfirmFields.all.firstWhere((f) => f.key == key), p);
    expect([shown('dateOfBirth'), shown('gender'), shown('stillStudying'), shown('graduationYear'), shown('mobile2')], ['18 Apr 1993', 'Male', 'No', '2015', null]);
    expect(confirmValueOf(ConfirmFields.all.firstWhere((f) => f.key == 'militaryStatus'), {...p, 'gender': 'female'}), 'Not applicable');
  });

  testWidgets('shows only the review, in the website’s parts, until they confirm; then the app', (tester) async {
    people.on('POST /api/employees/e1/confirm', (req) {
      profile = profileWith(confirmed);
      return json(confirmed, 201);
    });
    await openApp(tester, people);

    expect(find.byType(ReviewScreen), findsOneWidget);
    expect(find.text(ReviewWords.title), findsOneWidget);
    expect(find.text(ReviewWords.never), findsOneWidget);
    expect(find.text(ReviewWords.signOut), findsOneWidget);
    // nothing of the app behind it: no tabs
    expect(find.text(ShellWords.requests), findsNothing);
    expect(find.text('Full name (English)'), findsOneWidget);
    expect(find.text('Mohamed Abdelrahman'), findsWidgets);
    for (final part in ['Contact & Address', 'Emergency Contact', 'Education']) {
      await scrollToFind(tester, find.text(part));
    }
    await scrollToFind(tester, find.text('Very good'));

    // the statement must be ticked
    await scrollToFind(tester, find.text(ReviewWords.confirm));
    expect(find.text(ProfileDisclaimer.en), findsOneWidget);
    expect(find.text(ProfileDisclaimer.ar), findsOneWidget);
    await tester.tap(find.text(ReviewWords.confirm));
    await tester.pumpAndSettle();
    expect(find.text(ReviewWords.mustAccept), findsOneWidget);
    expect(people.calls, isNot(contains('POST /api/employees/e1/confirm')));

    await tester.tap(find.text(ReviewWords.accept));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ReviewWords.confirm));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/employees/e1/confirm'), {'accept': true, 'disclaimerVersion': 1});
    // read again: confirmed, so the app opens
    expect(find.byType(ReviewScreen), findsNothing);
    expect(find.text(ShellWords.requests), findsOneWidget);
  });

  testWidgets('marks what HR changed since they confirmed, and says People’s refusal in its words', (tester) async {
    profile = profileWith(changedMobile);
    people.on('POST /api/employees/e1/confirm', (req) => json({'message': 'The statement has changed; read it again and confirm.'}, 409));
    await openApp(tester, people);
    expect(find.text(ReviewWords.changed('Mobile')), findsOneWidget);
    await scrollToFind(tester, find.text(ReviewWords.changedSince));
    expect(find.text(ReviewWords.changedSince), findsOneWidget);

    await scrollToFind(tester, find.text(ReviewWords.confirm));
    await tester.tap(find.text(ReviewWords.accept));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ReviewWords.confirm));
    await tester.pumpAndSettle();
    expect(find.text('The statement has changed; read it again and confirm.'), findsOneWidget);
    expect(find.byType(ReviewScreen), findsOneWidget);
  });

  testWidgets('asking HR for a change lets them in while HR decides', (tester) async {
    people.on('POST /api/employees/e1/change-requests', (req) {
      profile = profileWith(never, requests: [pendingRequestJson()]);
      return json(pendingRequestJson(), 201);
    });
    await openApp(tester, people);
    await scrollToFind(tester, find.text(ReviewWords.askForChange));
    await tester.tap(find.text(ReviewWords.askForChange));
    await tester.pumpAndSettle();
    // the Profile's sheet, every part to change
    final mobile = find.widgetWithText(TextField, '+201012345678');
    await tester.ensureVisible(mobile);
    await tester.enterText(mobile, '+201099999999');
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text(ChangeWords.send));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ChangeWords.send));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/employees/e1/change-requests')['changes'], {'mobile': '+201099999999'});
    expect(find.byType(ReviewScreen), findsNothing);
    expect(find.text(ShellWords.requests), findsOneWidget);
  });

  testWidgets('a change waiting lets them through, and they may still confirm from the Profile', (tester) async {
    profile = profileWith(never, requests: [pendingRequestJson()]);
    people.on('POST /api/employees/e1/confirm', (req) {
      profile = profileWith(confirmed, requests: [pendingRequestJson()]);
      return json(confirmed, 201);
    });
    await openApp(tester, people);
    expect(find.byType(ReviewScreen), findsNothing);
    await tester.tap(find.text(ShellWords.profile));
    await tester.pumpAndSettle();
    expect(find.text(ProfileWords.confirmNow), findsOneWidget);
    expect(find.textContaining('People website'), findsNothing);
    await tester.tap(find.text(ProfileWords.reviewDetails));
    await tester.pumpAndSettle();
    expect(find.byType(ReviewScreen), findsOneWidget);
    expect(find.text(ReviewWords.changeWaiting), findsOneWidget);
    // opened by choice: closed, not signed out of
    expect(find.text(ReviewWords.signOut), findsNothing);
    await scrollToFind(tester, find.text(ReviewWords.confirm));
    await tester.tap(find.text(ReviewWords.accept));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ReviewWords.confirm));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/employees/e1/confirm'));
    expect(find.byType(ReviewScreen), findsNothing);
    expect(find.text(ProfileWords.confirmNow), findsNothing);
  });

  testWidgets('keeps Sign out within reach', (tester) async {
    await openApp(tester, people);
    await tester.tap(find.text(ReviewWords.signOut));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/auth/logout'));
    expect(find.byType(ReviewScreen), findsNothing);
  });

  testWidgets('holds back nobody whose details are confirmed, or whose profile can’t be read', (tester) async {
    profile = profileWith(confirmed);
    await openApp(tester, people);
    expect(find.byType(ReviewScreen), findsNothing);
    expect(find.text(ShellWords.requests), findsOneWidget);
  });

  testWidgets('a profile People won’t send holds nobody back', (tester) async {
    people.on('GET /api/employees/e1', (req) => json({'message': 'Something went wrong.'}, 500));
    await openApp(tester, people);
    expect(find.byType(ReviewScreen), findsNothing);
    expect(find.text(ShellWords.requests), findsOneWidget);
  });
}
