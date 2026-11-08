import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/dashboard/dashboard_screen.dart';
import 'package:people/features/dashboard/shift_card.dart';
import 'package:people/providers.dart';
import 'package:people/shell/app_shell.dart';
import 'package:people/theme/tokens.dart';
import 'package:people/theme/wide.dart';

import 'dashboard_test.dart' show todayJson;
import 'fakes.dart';

// On an iPad (owner, 7 November 2026: "can the app be optimized for ipad screen?"): the page keeps to a column in the
// middle, the tab bar to its own width, and the quick actions go four across; a phone keeps the phone design. Since 8
// November 2026 (owner: "i think the Ipad needs a better layout with some more features available due to the larger
// screen") an iPad's window has the rail or the sidebar instead of the tab bar (ipad_layout_test.dart); the column in the
// middle stays for the phone's layout on a wide window (a phone on its side) and for a page beside the rail.

/// A 12.9" iPad upright: 1024 × 1366 points.
void iPadScreen(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(2048, 2732)
    ..devicePixelRatio = 2;
  addTearDown(tester.view.reset);
}

/// A large iPhone on its side: 932 × 430 points.
void phoneOnItsSide(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(2796, 1290)
    ..devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<void> open(WidgetTester tester, FakePeople people) async {
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json(todayJson()));
  });

  testWidgets('the phone’s layout on a wide window: the page in a column in the middle, the tab bar its own width, four quick actions across', (tester) async {
    phoneOnItsSide(tester);
    await open(tester, people);
    final card = tester.getRect(find.byType(ShiftCard));
    expect(card.width, Tokens.pageMaxWidth - Tokens.pagePadding.horizontal);
    expect(card.center.dx, 466);
    final bar = tester.getRect(find.byType(TabBarFloating));
    expect(bar.width, Tokens.tabBarMaxWidth);
    expect(bar.center.dx, 466);
    await tester.scrollUntilVisible(find.text(DashboardWords.myPerformance), 200, scrollable: find.byType(Scrollable).first);
    expect(tester.getCenter(find.text(DashboardWords.requestLeave)).dy, tester.getCenter(find.text(DashboardWords.myPerformance)).dy);
  });

  testWidgets('on an iPad upright (8 November 2026): the rail in place of the tab bar, the Dashboard beside it in two columns', (tester) async {
    iPadScreen(tester);
    await open(tester, people);
    expect(find.byType(TabBarFloating), findsNothing);
    final card = tester.getRect(find.byType(ShiftCard));
    expect(card.left, Tokens.railWidth + Tokens.pagePadding.left);
    expect(card.width, (1024 - Tokens.railWidth - Tokens.pagePadding.horizontal - 16) / 2);
    expect(tester.getRect(find.text(DashboardWords.requestLeave)).left, greaterThan(card.right));
    expect(tester.getCenter(find.text(DashboardWords.requestLeave)).dy, lessThan(tester.getCenter(find.text(DashboardWords.myPerformance)).dy));
  });

  testWidgets('on a phone: as the phone design, two quick actions across and the tab bar edge to edge', (tester) async {
    phoneScreen(tester);
    await open(tester, people);
    expect(tester.getRect(find.byType(ShiftCard)).width, 412 - Tokens.pagePadding.horizontal);
    expect(tester.getRect(find.byType(TabBarFloating)).width, 412 - 24);
    await tester.scrollUntilVisible(find.text(DashboardWords.myPerformance), 200, scrollable: find.byType(Scrollable).first);
    expect(tester.getCenter(find.text(DashboardWords.requestLeave)).dy, lessThan(tester.getCenter(find.text(DashboardWords.myPerformance)).dy));
  });

  testWidgets('centredPadding: a phone keeps the margins; a wider screen grows them to keep the column', (tester) async {
    late EdgeInsets phone, iPad;
    Widget probe(Size size, void Function(EdgeInsets) keep) => MediaQuery(
      data: MediaQueryData(size: size),
      child: Builder(
        builder: (context) {
          keep(centredPadding(context, Tokens.pagePadding));
          return const SizedBox();
        },
      ),
    );
    await tester.pumpWidget(probe(const Size(412, 915), (e) => phone = e));
    await tester.pumpWidget(probe(const Size(1366, 1024), (e) => iPad = e));
    expect(phone, Tokens.pagePadding);
    expect(iPad.left, Tokens.pagePadding.left + (1366 - Tokens.pageMaxWidth) / 2);
    expect(iPad.right, iPad.left);
    expect(iPad.top, Tokens.pagePadding.top);
    expect(isWide(1024 - 36), isTrue);
    expect(isWide(412 - 36), isFalse);
  });
}
