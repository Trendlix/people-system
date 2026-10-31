import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/kpis/kpi_words.dart';
import 'package:people/providers.dart';
import 'package:people/shell/app_shell.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/theme/look.dart';

import 'fakes.dart';
import 'kpi_models_test.dart' show cardJson, viewJson;

// The KPIs in the app (owner, 31 October 2026: "employees and managers can perform the KPI's from the mobile app"), as
// the website has them: the employee rates themself (saved or sent, the score worked out as they pick) and signs "I've
// read it"; a manager reaches Team KPIs from the More menu and scores their people's (with the self-rating beside each
// metric, the comments needed to send it, and only once the self-rating is in or its day has passed). What People
// refuses is said in its words; a scorecard that moved on meanwhile is read again.

Map<String, Object?> meWith(List<String> roles) => {'id': 'u1', 'email': 'h.test@example.test', 'roles': roles, 'name': 'Mohamed Abdelrahman', 'employeeId': 'e1'};

const settingsJson = {'selfRatingDay': 3, 'managerDay': 6, 'hrDay': 8, 'signOffDay': 10, 'attendanceInKpi': true};

/// A phone's width, tall enough that a whole scorecard is laid out at once (the list builds only what it shows).
void tallPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(1080, 1080 / 412 * 7000)
    ..devicePixelRatio = 1080 / 412;
  addTearDown(tester.view.reset);
}

Future<void> boot(WidgetTester tester, FakePeople people) async {
  tallPhone(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

/// Opens an address of the app, as a link in it would.
Future<void> goTo(WidgetTester tester, String path) async {
  GoRouter.of(tester.element(find.byType(AppShell))).go(path);
  await tester.pumpAndSettle();
}

Future<void> tapOn(WidgetTester tester, Finder finder) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Finder field(String label) => find.widgetWithText(TextField, label);
Finder inDialog(String text) => find.descendant(of: find.byType(AlertDialog), matching: find.text(text));
bool enabled(WidgetTester tester, String label) => tester.widget<ButtonStyleButton>(find.widgetWithText(FilledButton, label)).onPressed != null;

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meWith(['employee'])))
      ..on('GET /api/kpis/settings', (req) => json(settingsJson))
      ..on('GET /api/kpis/scorecards/mine', (req) => json([cardJson(), cardJson(id: 'k0', month: '2026-09', status: 'final', action: null, deadline: null, finalPercent: 95, level: 'meets')]))
      ..on('GET /api/kpis/scorecards/waiting', (req) => json([cardJson()]))
      ..on('GET /api/kpis/scorecards/k1', (req) => json(viewJson()));
  });

  group('the employee', () {
    testWidgets('sees what waits, rates themself with the score worked out as they pick, and sends it', (tester) async {
      people.on(
        'POST /api/kpis/scorecards/k1/self',
        (req) => json(
          viewJson(
            status: 'manager',
            action: null,
            can: const {},
            m1Self: {'choice': 2, 'comment': 'Shipped every brief'},
            m2Self: {'choice': 1, 'comment': null},
            comments: const {'self': 'A good month'},
          ),
        ),
      );
      await boot(tester, people);
      // an employee's More menu has no Team KPIs
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      expect(find.text(KpiWords.teamTitle), findsNothing);
      await tester.tapAt(const Offset(200, 60));
      await tester.pumpAndSettle();

      await goTo(tester, '/dashboard/performance');
      expect(find.text(KpiWords.myTitle), findsOneWidget);
      expect(find.text('Your October 2026 KPI: rate yourself by 03/11/2026'), findsOneWidget);
      expect(find.text('September 2026'), findsOneWidget);
      expect(find.text('95%'), findsOneWidget);
      expect(find.text('By the 3rd'), findsOneWidget);

      await tapOn(tester, find.widgetWithText(FilledButton, 'Rate yourself'));
      expect(find.text('${KpiWords.yourStep}: Rate yourself by 03/11/2026'), findsOneWidget);
      expect(find.text(KpiWords.yourSelfRating), findsOneWidget);
      // nothing picked yet: Send waits, Save doesn't
      expect(enabled(tester, KpiWords.sendSelf), isFalse);
      expect(find.text(KpiWords.stillToPick(['On-time delivery', 'Learning'])), findsOneWidget);

      await tapOn(tester, find.text('Always on time').first);
      await tapOn(tester, find.text('Mostly on time').at(1));
      // 40 of 40 in Delivery; 30 + the Attendance metric's 20 of 60 in Discipline: 100 × 50% + 83.3 × 50%
      expect(find.text('91.7%'), findsOneWidget);
      expect(find.text('Meets expectations'), findsOneWidget);
      expect(find.text(KpiWords.readyToSend), findsOneWidget);

      await tapOn(tester, find.text('${KpiWords.addComment} ${KpiWords.optional}').first);
      await tester.enterText(field('${KpiWords.comment} ${KpiWords.optional}'), 'Shipped every brief');
      await tester.enterText(field(KpiWords.commentSelfLabel), 'A good month');
      await tapOn(tester, find.widgetWithText(FilledButton, KpiWords.sendSelf));
      expect(find.text(KpiWords.confirmSelf), findsOneWidget);
      await tester.tap(inDialog(KpiWords.sendSelf));
      await tester.pumpAndSettle();

      expect(people.bodyOf('POST /api/kpis/scorecards/k1/self'), {
        'picks': [
          {'metricId': 'm1', 'choice': 2, 'comment': 'Shipped every brief'},
          {'metricId': 'm2', 'choice': 1, 'comment': null},
        ],
        'comment': 'A good month',
        'submit': true,
      });
      expect(find.text('Your self-rating is sent. Your manager scores the month next; you see the score at the sign-off.'), findsOneWidget);
      // the step is taken: no form left; back on My KPIs, the lists are read again
      expect(find.widgetWithText(FilledButton, KpiWords.sendSelf), findsNothing);
      final before = people.calls.where((c) => c == 'GET /api/kpis/scorecards/mine').length;
      await tapOn(tester, find.text(KpiWords.myTitle));
      expect(find.text(KpiWords.history), findsOneWidget);
      expect(people.calls.where((c) => c == 'GET /api/kpis/scorecards/mine').length, greaterThan(before));
    });

    testWidgets('saves for later; People’s refusal is said in its words; a scorecard moved on meanwhile is read again', (tester) async {
      people.on('POST /api/kpis/scorecards/k1/self', (req) => json(viewJson(m1Self: {'choice': 0, 'comment': null})));
      await boot(tester, people);
      await goTo(tester, '/dashboard/performance');
      await tapOn(tester, find.widgetWithText(FilledButton, 'Rate yourself'));

      await tapOn(tester, find.text('Often late').first);
      await tapOn(tester, find.widgetWithText(OutlinedButton, KpiWords.save));
      expect(people.bodyOf('POST /api/kpis/scorecards/k1/self')['submit'], isFalse);
      expect((people.bodyOf('POST /api/kpis/scorecards/k1/self')['picks'] as List).last, {'metricId': 'm2', 'choice': null, 'comment': null});
      expect(find.text('Your self-rating is saved, not sent yet. Send it by 03/11/2026.'), findsOneWidget);

      people.on('POST /api/kpis/scorecards/k1/self', (req) => json({'message': ['Keep the comment to 1000 characters or fewer.']}, 400));
      await tapOn(tester, find.widgetWithText(OutlinedButton, KpiWords.save));
      expect(find.text('Keep the comment to 1000 characters or fewer.'), findsOneWidget);

      people
        ..on('POST /api/kpis/scorecards/k1/self', (req) => json({'message': 'This scorecard moved on meanwhile. Reload the page to see where it is.'}, 409))
        ..on('GET /api/kpis/scorecards/k1', (req) => json(viewJson(status: 'manager', action: null, can: const {})));
      await tapOn(tester, find.widgetWithText(OutlinedButton, KpiWords.save));
      expect(find.text(KpiWords.moved), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, KpiWords.save), findsNothing);
      expect(find.text('With the manager'), findsOneWidget);
    });

    testWidgets('sees the score at the sign-off and signs that they have read it', (tester) async {
      final signing = viewJson(
        status: 'sign_off',
        action: 'sign',
        can: const {'signAsEmployee': true},
        m1Self: {'choice': 2, 'comment': null},
        m1Manager: {'choice': 1, 'comment': 'Two briefs slipped'},
        m2Manager: {'choice': 2, 'comment': null},
        score: {'pillars': [], 'finalPercent': 87.5, 'level': 'needs_improvement', 'complete': true, 'capped': false},
        comments: const {'manager': 'Solid month; plan the briefs earlier.'},
        finalPercent: 87.5,
        level: 'needs_improvement',
      );
      people
        ..on('GET /api/kpis/scorecards/waiting', (req) => json([cardJson(status: 'sign_off', action: 'sign', deadline: '2026-11-10')]))
        ..on('GET /api/kpis/scorecards/k1', (req) => json(signing))
        ..on('POST /api/kpis/scorecards/k1/sign', (req) => json({...signing, 'can': const {}, 'action': null, 'signed': {'employee': true, 'manager': false}}));
      await boot(tester, people);
      await goTo(tester, '/dashboard/performance');
      expect(find.text('Your October 2026 KPI: ready to sign by 10/11/2026'), findsOneWidget);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Sign'));

      expect(find.text('87.5%'), findsOneWidget);
      expect(find.text('Needs improvement'), findsOneWidget);
      expect(find.text('“Solid month; plan the briefs earlier.”'), findsOneWidget);
      expect(find.text(KpiWords.signYours), findsOneWidget);
      expect(find.widgetWithText(FilledButton, KpiWords.sendSelf), findsNothing);

      await tester.enterText(field('${KpiWords.comment} ${KpiWords.optional}'), 'Thanks, noted.');
      await tapOn(tester, find.widgetWithText(FilledButton, KpiWords.iveReadIt));
      expect(people.bodyOf('POST /api/kpis/scorecards/k1/sign'), {'comment': 'Thanks, noted.'});
      expect(find.text('Signed. It is final once both have signed, or after 10/11/2026 anyway.'), findsOneWidget);
      expect(find.text(KpiWords.signYours), findsNothing);
      expect(find.text('✓ The employee signed'), findsOneWidget);
    });
  });

  group('the manager', () {
    Map<String, Object?> omars({String status = 'manager', String? action = 'score', Map<String, Object?> can = const {'score': true}, String due = '2026-11-03'}) => viewJson(
      id: 'k2',
      status: status,
      action: action,
      employeeId: 'e2',
      name: 'Omar Ali',
      can: can,
      selfRatingDeadline: due,
      m1Self: {'choice': 2, 'comment': 'Every brief on time'},
      m2Self: {'choice': 2, 'comment': null},
      selfScore: {'pillars': [], 'finalPercent': 100, 'level': 'meets', 'complete': true, 'capped': false},
      comments: const {'self': 'My best month'},
    );

    setUp(() {
      people
        ..on('GET /api/auth/me', (req) => json(meWith(['employee', 'manager'])))
        ..on('GET /api/kpis/counts', (req) => json({'self': 0, 'team': 1, 'hr': 0}))
        ..on('GET /api/kpis/scorecards/waiting', (req) => json([cardJson(id: 'k2', employeeId: 'e2', name: 'Omar Ali', status: 'manager', action: 'score', deadline: '2026-11-06')]))
        ..on('GET /api/kpis/heatmap', (req) => json({'months': ['2026-09', '2026-10'], 'rows': [], 'distribution': {}}))
        ..on('GET /api/kpis/scorecards', (req) {
          expect(req.url.queryParameters, {'scope': 'team', 'month': '2026-10'});
          return json([cardJson(id: 'k2', employeeId: 'e2', name: 'Omar Ali', status: 'manager', action: 'score', deadline: '2026-11-06')]);
        })
        ..on('GET /api/kpis/scorecards/k2', (req) => json(omars()));
    });

    testWidgets('reaches Team KPIs from the More menu, scores with the self-rating beside each metric, and sends it with comments', (tester) async {
      people.on('POST /api/kpis/scorecards/k2/score', (req) => json(omars(status: 'hr', action: null, can: const {})));
      await boot(tester, people);
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      await tester.tap(find.text(KpiWords.teamTitle));
      await tester.pumpAndSettle();

      expect(find.text(KpiWords.teamIntro), findsOneWidget);
      expect(find.text('October 2026 · Score by 06/11/2026'), findsOneWidget);
      expect(find.text(KpiWords.scorecardsOf('October 2026')), findsOneWidget);
      expect(find.text('Omar Ali'), findsNWidgets(2));

      await tapOn(tester, find.text('Omar Ali').first);
      expect(find.text(KpiWords.yourScoring), findsOneWidget);
      expect(find.text('Omar Ali · Designer · Creative'), findsOneWidget);
      // the self-rating beside each metric, and its score
      expect(find.text(KpiWords.selfRating), findsWidgets);
      expect(find.text('Self-rating: 100% · Meets expectations.'), findsOneWidget);

      await tapOn(tester, find.text('Mostly on time').first);
      await tapOn(tester, find.text('Always on time').at(1));
      // the comments are needed to send it: nothing sent without them
      await tapOn(tester, find.widgetWithText(FilledButton, KpiWords.sendScoring));
      expect(find.text(KpiWords.writeComments), findsOneWidget);
      expect(people.calls, isNot(contains('POST /api/kpis/scorecards/k2/score')));

      await tester.enterText(field(KpiWords.commentScoreLabel), 'Strong month. Plan the briefs a day earlier.');
      await tapOn(tester, find.widgetWithText(FilledButton, KpiWords.sendScoring));
      expect(find.text(KpiWords.confirmScore('Omar Ali')), findsOneWidget);
      await tester.tap(inDialog(KpiWords.sendScoring));
      await tester.pumpAndSettle();

      expect(people.bodyOf('POST /api/kpis/scorecards/k2/score'), {
        'picks': [
          {'metricId': 'm1', 'choice': 1, 'comment': null},
          {'metricId': 'm2', 'choice': 2, 'comment': null},
        ],
        'comment': 'Strong month. Plan the briefs a day earlier.',
        'submit': true,
      });
      expect(find.text('Your scoring is sent to HR to calibrate.'), findsOneWidget);
    });

    testWidgets('while the self-rating is still open, saves the scoring but can’t send it yet', (tester) async {
      people
        ..on('GET /api/kpis/scorecards/k2', (req) => json(omars(status: 'self_rating', action: null, due: '2999-01-03')))
        ..on('POST /api/kpis/scorecards/k2/score', (req) => json(omars(status: 'self_rating', action: null, due: '2999-01-03')));
      await boot(tester, people);
      await goTo(tester, '/dashboard/performance/team');
      await tapOn(tester, find.text('Omar Ali').last);

      await tapOn(tester, find.text('Always on time').first);
      await tapOn(tester, find.text('Always on time').at(1));
      expect(find.text(KpiWords.waitsForSelf('03/01/2999')), findsOneWidget);
      expect(enabled(tester, KpiWords.sendScoring), isFalse);

      await tapOn(tester, find.widgetWithText(OutlinedButton, KpiWords.save));
      expect(people.bodyOf('POST /api/kpis/scorecards/k2/score')['submit'], isFalse);
      expect(find.text('Your scoring is saved, not sent yet. Send it by 06/11/2026.'), findsOneWidget);
    });

    testWidgets('My KPIs leads them to Team KPIs, with how many wait', (tester) async {
      await boot(tester, people);
      await goTo(tester, '/dashboard/performance');
      expect(find.text(KpiWords.teamWaitingOf(1)), findsOneWidget);
      await tapOn(tester, find.text(KpiWords.teamTitle));
      expect(find.text(KpiWords.teamIntro), findsOneWidget);
    });
  });

  group('fits a phone', () {
    // long words everywhere, on a common phone and a narrow one, light and dark: scrolled top to bottom, nothing overflows
    for (final (width, dark, editing) in [(412.0, false, false), (360.0, true, false), (412.0, true, true), (360.0, false, true)]) {
      testWidgets('${width.toInt()} wide, ${dark ? 'dark' : 'light'}, ${editing ? 'rating' : 'signing'}', (tester) async {
        final long = viewJson(
          name: 'Mohamed Abdelrahman Abdelaziz El-Sayed',
          status: editing ? 'self_rating' : 'sign_off',
          action: editing ? 'self_rate' : 'sign',
          can: editing ? const {'selfRate': true} : const {'signAsEmployee': true},
          m1Self: {'choice': 2, 'comment': 'Every brief this month went out on the day it was due, including the two rush jobs.'},
          m1Manager: {'choice': 1, 'comment': 'Two briefs slipped by a day.'},
          score: editing ? null : {
            'pillars': [
              {'key': 'delivery', 'name': 'Delivery & Timeliness', 'short': 'Delivery & Timeliness', 'weight': 50, 'achieved': 30, 'max': 40, 'percent': 75, 'complete': true},
              {'key': 'discipline', 'name': 'Discipline & Growth', 'short': 'Discipline', 'weight': 50, 'achieved': 50, 'max': 60, 'percent': 83.3, 'complete': true},
            ],
            'finalPercent': 79.2,
            'level': 'needs_improvement',
            'complete': true,
            'capped': false,
          },
          comments: const {'self': 'A long month with many deliveries and a lot learned along the way.'},
          finalPercent: 79.2,
          level: 'needs_improvement',
        );
        // the criteria's words long too
        for (final p in long['pillars'] as List) {
          for (final m in (p as Map)['metrics'] as List) {
            (m as Map)['criteria'] = [
              {'label': 'Delivered everything on the agreed day without any reminders from the team', 'points': 40},
              {'label': 'Mostly on time', 'points': 30},
            ];
          }
        }
        people.on('GET /api/kpis/scorecards/k1', (req) => json(long));
        tester.view
          ..physicalSize = Size(width * 3, 915 * 3)
          ..devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          ProviderScope(
            retry: noRetry,
            overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), look: MemoryLookStore(dark ? ThemeMode.dark : ThemeMode.light)),
            child: const PeopleApp(),
          ),
        );
        await tester.pumpAndSettle();
        await goTo(tester, '/dashboard/performance');
        await tester.tap(find.widgetWithText(FilledButton, 'Rate yourself'));
        await tester.pumpAndSettle();
        final page = find.descendant(of: find.byType(ListView).last, matching: find.byType(Scrollable)).first;
        for (var i = 0; i < 40; i++) {
          await tester.drag(page, const Offset(0, -400));
          await tester.pumpAndSettle();
        }
        expect(find.text(KpiWords.everyStep), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  });

  testWidgets('HR’s calibration is said to be on the website; the scorecard is shown as it stands', (tester) async {
    people
      ..on('GET /api/auth/me', (req) => json(meWith(['hr'])))
      ..on('GET /api/kpis/scorecards/k1', (req) => json(viewJson(status: 'hr', action: 'calibrate', employeeId: 'e9', name: 'Laila Hassan', can: const {'calibrate': true})));
    await boot(tester, people);
    await goTo(tester, '/dashboard/performance');
    await tapOn(tester, find.text('October 2026').first);
    expect(find.text(KpiWords.calibrateOnWebsite), findsOneWidget);
    expect(find.widgetWithText(FilledButton, KpiWords.sendScoring), findsNothing);
  });
}
