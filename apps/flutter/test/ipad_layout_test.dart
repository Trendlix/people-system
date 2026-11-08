import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/about/diagnostics.dart' show AboutWords;
import 'package:people/features/assets/my_assets_screen.dart';
import 'package:people/features/attendance/attendance_data.dart';
import 'package:people/features/attendance/attendance_words.dart';
import 'package:people/features/attendance/calendar_card.dart';
import 'package:people/features/attendance/day_sheet.dart';
import 'package:people/features/dashboard/dashboard_screen.dart';
import 'package:people/features/dashboard/shift_card.dart';
import 'package:people/features/kpis/kpi_words.dart';
import 'package:people/features/requests/approvals.dart';
import 'package:people/features/requests/history.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/requests_tab.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/features/timesheet/timesheet_words.dart';
import 'package:people/models/me.dart';
import 'package:people/models/requests.dart';
import 'package:people/providers.dart';
import 'package:people/shell/app_shell.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/shell/side_nav.dart';
import 'package:people/theme/tokens.dart';
import 'package:people/theme/wide.dart';

import 'approvals_test.dart' show waitingLeave;
import 'attendance_models_test.dart' as attendance show correctionJson;
import 'attendance_models_test.dart' show octoberJson;
import 'dashboard_test.dart' show todayJson;
import 'fakes.dart';
import 'profile_models_test.dart' show kpisJson;
import 'requests_fixtures.dart';
import 'timesheet_test.dart' show weekJson;

// The iPad's own layout (owner, 8 November 2026: "i think the Ipad needs a better layout with some more features available
// due to the larger screen"): the rail upright and the sidebar on its side instead of the tab bar, each listing the tabs
// and what the More menu holds; Requests and Attendance in two panes, a list and what is open in it; the Dashboard in two
// columns with what waits for approval and the latest KPI scorecards; and the phone's layout in a narrow window (Split
// View) or on a phone on its side.

/// A 12.9" iPad upright, on its side, half a Split View on its side, and a large iPhone on its side (points).
const upright = Size(1024, 1366);
const onItsSide = Size(1366, 1024);
const halfSplitView = Size(678, 1024);
const phoneOnItsSide = Size(932, 430);

void window(WidgetTester tester, Size points) {
  tester.view
    ..physicalSize = points * 2
    ..devicePixelRatio = 2;
  addTearDown(tester.view.reset);
}

Future<void> boot(WidgetTester tester, FakePeople people, Size points, {List<Override> more = const []}) async {
  window(tester, points);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [...overridesFor(people, store: MemorySessionStore(token: 'kept')), ...more],
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

/// A place in the rail or the sidebar, by its words.
Finder inNav(String words) => find.descendant(of: find.byType(SideNav), matching: find.text(words));

void main() {
  group('breakpoints', () {
    test('by the window, never the device: the tab bar, the rail upright, the sidebar on its side', () {
      expect(navLayoutOf(const Size(412, 915)), NavLayout.phone); // a phone
      expect(navLayoutOf(phoneOnItsSide), NavLayout.phone); // a phone on its side: too short
      expect(navLayoutOf(const Size(375, 1024)), NavLayout.phone); // Slide Over, a third of a Split View
      expect(navLayoutOf(halfSplitView), NavLayout.phone);
      expect(navLayoutOf(const Size(744, 1133)), NavLayout.rail); // an iPad mini upright
      expect(navLayoutOf(const Size(834, 1210)), NavLayout.rail); // an 11" upright
      expect(navLayoutOf(upright), NavLayout.rail);
      expect(navLayoutOf(const Size(981, 1024)), NavLayout.rail); // two thirds of a Split View on its side
      expect(navLayoutOf(const Size(1133, 744)), NavLayout.sidebar); // an iPad mini on its side
      expect(navLayoutOf(onItsSide), NavLayout.sidebar);
    });

    test('the page under a place: the longest address that holds it', () {
      const paths = ['/dashboard', '/profile', '/dashboard/performance', '/dashboard/performance/team', '/profile/assets'];
      expect(currentPlaceOf('/dashboard', paths), '/dashboard');
      expect(currentPlaceOf('/dashboard/performance/team', paths), '/dashboard/performance/team');
      expect(currentPlaceOf('/dashboard/timesheet', paths), '/dashboard');
      expect(currentPlaceOf('/profile/performance', paths), '/profile');
      expect(currentPlaceOf('/profile/assets', paths), '/profile/assets');
      expect(currentPlaceOf('/requests', paths), isNull);
    });

    test('the More menu and the iPad list the same places to the same people', () {
      List<String> labels(Me me, {bool logsHours = false}) => [for (final p in morePlaces(me, logsHours: logsHours)) p.label];
      final employee = Me.fromJson(meJson());
      final manager = Me.fromJson({...meJson(), 'roles': ['employee', 'manager']});
      final noProfile = Me.fromJson({...meJson(), 'employeeId': null});
      expect(labels(employee), [
        ShellWords.viewProfile,
        ShellWords.changePhoto,
        ShellWords.assets,
        ShellWords.password,
        ShellWords.devices,
        ShellWords.hiring,
        KpiWords.myTitle,
        AboutWords.menu,
      ]);
      expect(labels(manager, logsHours: true), containsAllInOrder([KpiWords.myTitle, KpiWords.teamTitle, TimesheetWords.menu, AboutWords.menu]));
      expect(labels(noProfile, logsHours: true), [ShellWords.password, ShellWords.devices, AboutWords.menu]);
    });
  });

  group('the frame', () {
    late FakePeople people;

    setUp(() {
      people = FakePeople()
        ..on('GET /api/auth/me', (req) => json(meJson()))
        ..on('GET /api/me/attendance/today', (req) => json(todayJson()));
    });

    testWidgets('upright: the rail instead of the tab bar, the tabs and the More menu’s places one tap away', (tester) async {
      await boot(tester, people, upright);
      expect(find.byType(TabBarFloating), findsNothing);
      expect(find.text(ShellWords.more), findsNothing);
      expect(tester.getRect(find.byType(SideNav)).width, Tokens.railWidth);
      for (final words in [
        SideNavWords.dashboard,
        ShellWords.requests,
        ShellWords.attendance,
        ShellWords.profile,
        SideNavWords.myKpis,
        SideNavWords.assets,
        SideNavWords.photo,
        SideNavWords.password,
        SideNavWords.devices,
        SideNavWords.hiring,
        SideNavWords.about,
        SideNavWords.signOut,
      ]) {
        expect(inNav(words), findsOneWidget, reason: words);
      }
      // a manager's Team KPIs and the timesheet only for those they are for, as in the More menu
      expect(inNav(SideNavWords.teamKpis), findsNothing);
      expect(inNav(SideNavWords.timesheet), findsNothing);
      // the sun/moon and the bell over the page
      expect(find.byTooltip(ShellWords.toDark), findsOneWidget);

      // My assets, which hid in the More menu, in one tap
      await tester.tap(inNav(SideNavWords.assets));
      await tester.pumpAndSettle();
      expect(find.byType(MyAssetsScreen), findsOneWidget);
      // and back to a tab
      await tester.tap(inNav(ShellWords.requests));
      await tester.pumpAndSettle();
      expect(find.text(RequestsWords.title), findsOneWidget);
    });

    testWidgets('on its side: the sidebar with the places in full, who is signed in, and Sign out', (tester) async {
      people
        ..on('GET /api/auth/me', (req) => json({...meJson(), 'roles': ['employee', 'manager']}))
        ..on('GET /api/me/timesheet', (req) => json(weekJson()))
        ..on('POST /api/auth/logout', (req) => json({}, 204));
      await boot(tester, people, onItsSide);
      expect(find.byType(TabBarFloating), findsNothing);
      expect(tester.getRect(find.byType(SideNav)).width, Tokens.sidebarWidth);
      for (final words in [
        ShellWords.dashboard,
        ShellWords.requests,
        ShellWords.attendance,
        ShellWords.profile,
        KpiWords.myTitle,
        KpiWords.teamTitle,
        TimesheetWords.menu,
        ShellWords.assets,
        ShellWords.changePhoto,
        ShellWords.password,
        ShellWords.devices,
        ShellWords.hiring,
        AboutWords.menu,
        'Hazem Soliman',
        'h.test@example.test',
      ]) {
        expect(inNav(words), findsOneWidget, reason: words);
      }
      // View profile is the Profile tab itself
      expect(inNav(ShellWords.viewProfile), findsNothing);

      await tester.tap(inNav(ShellWords.signOut));
      await tester.pumpAndSettle();
      expect(find.text(SignInWords.title), findsOneWidget);
    });

    testWidgets('the Dashboard in two columns: the shift beside the quick actions, what waits for approval, the latest KPIs', (tester) async {
      people
        ..on('GET /api/auth/me', (req) => json({...meJson(), 'roles': ['employee', 'manager']}))
        ..on('GET /api/leave/requests', (req) => json([waitingLeave('w1', '2026-10-20T08:00:00.000Z')]))
        ..on('GET /api/kpis/scorecards/mine', (req) => json(kpisJson()));
      await boot(tester, people, onItsSide);
      final shift = tester.getRect(find.byType(ShiftCard));
      final quick = tester.getRect(find.text(DashboardWords.quickActions));
      expect(quick.left, greaterThan(shift.right));
      expect(quick.top, lessThan(shift.bottom));
      expect(shift.left, Tokens.sidebarWidth + Tokens.pagePadding.left);
      final page = find.descendant(of: find.byType(DashboardScreen), matching: find.byType(Scrollable)).first;
      await tester.scrollUntilVisible(find.text(DashboardWords.performance.toUpperCase()), 300, scrollable: page);
      expect(find.text(ApproveWords.title), findsOneWidget);
      expect(find.text(DashboardWords.performance.toUpperCase()), findsOneWidget);
      expect(find.text('October 2026'), findsWidgets);
    });

    testWidgets('an iPad mini upright (the rail, one column): the quick actions and the figures four across, as on 7 November', (tester) async {
      await boot(tester, people, const Size(744, 1133));
      expect(find.byType(SideNav), findsOneWidget);
      Rect tile(String title) => tester.getRect(find.ancestor(of: find.text(title), matching: find.byType(InkWell)).first);
      final first = tile(DashboardWords.requestLeave);
      final last = tile(DashboardWords.myPerformance);
      expect(last.top, first.top);
      expect(last.left, greaterThan(tile(DashboardWords.viewRequests).right));
      expect(first.height, Tokens.quickTileHeight);
      // At a glance: the four side by side, not a row to scroll
      final page = find.descendant(of: find.byType(DashboardScreen), matching: find.byType(Scrollable)).first;
      await tester.scrollUntilVisible(find.text(DashboardWords.nextHoliday), 300, scrollable: page);
      expect(tester.getRect(find.text(DashboardWords.nextHoliday)).top, tester.getRect(find.text(DashboardWords.hoursThisWeek)).top);
      expect(tester.getRect(find.text(DashboardWords.nextHoliday)).right, lessThan(744));
    });

    testWidgets('a narrow window (half a Split View) and a phone on its side keep the tab bar and the More menu', (tester) async {
      // half a Split View on an 11" iPad on its side (the 13"'s half, 678 wide, the breakpoints' test above)
      await boot(tester, people, const Size(590, 820));
      expect(find.byType(TabBarFloating), findsOneWidget);
      expect(find.byType(SideNav), findsNothing);
      await tester.tap(find.text(ShellWords.more));
      await tester.pumpAndSettle();
      expect(find.text(ShellWords.assets), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await boot(tester, people, phoneOnItsSide);
      expect(find.byType(TabBarFloating), findsOneWidget);
      expect(find.byType(SideNav), findsNothing);
    });

    testWidgets('turning the iPad keeps the tab and its page: the rail upright, the sidebar on its side', (tester) async {
      await boot(tester, people, upright);
      await tester.tap(inNav(ShellWords.attendance));
      await tester.pumpAndSettle();
      expect(find.text(AttendanceWords.title), findsOneWidget);
      window(tester, onItsSide);
      await tester.pumpAndSettle();
      expect(tester.getRect(find.byType(SideNav)).width, Tokens.sidebarWidth);
      expect(find.text(AttendanceWords.title), findsOneWidget);
      window(tester, halfSplitView);
      await tester.pumpAndSettle();
      expect(find.byType(TabBarFloating), findsOneWidget);
      expect(find.text(AttendanceWords.title), findsOneWidget);
    });
  });

  group('two panes', () {
    testWidgets('Requests: the list and the newest request side by side; another opens beside it, nothing pushed', (tester) async {
      final people = requestsPeople();
      await boot(tester, people, onItsSide);
      await tester.tap(inNav(ShellWords.requests));
      await tester.pumpAndSettle();
      final rows = historyRows([
        requestOf(RequestKind.leave, leaveJson(type: 'Casual leave', typeKey: 'casual', id: 'l2', status: 'approved', recordedByHr: true, canCancel: false, days: 1, start: '$y-10-26', end: '$y-10-26')),
        requestOf(RequestKind.permission, permissionJson()),
      ]);
      // the list on the left, the newest open on the right
      expect(find.text(RequestsWords.recentRequests), findsOneWidget);
      expect(find.text(RequestsWords.theRequest.toUpperCase()), findsOneWidget);
      expect(find.text(RequestsWords.everyStep), findsOneWidget);
      var page = tester.widget<RequestPage>(find.byType(RequestPage));
      expect((page.kind, page.id, page.inPane), (rows.first.request.kind, rows.first.request.id, true));
      expect(tester.getRect(find.byType(RequestPage)).left, greaterThan(tester.getRect(find.text(RequestsWords.recentRequests)).right));
      // no way back in the pane: nothing was pushed
      expect(find.widgetWithText(TextButton, RequestsWords.title), findsNothing);

      // the other one, beside the list
      await tester.ensureVisible(find.text(rows.last.when));
      await tester.pumpAndSettle();
      await tester.tap(find.text(rows.last.when));
      await tester.pumpAndSettle();
      page = tester.widget<RequestPage>(find.byType(RequestPage));
      expect((page.kind, page.id, page.inPane), (rows.last.request.kind, rows.last.request.id, true));
      expect(find.text(RequestsWords.recentRequests), findsOneWidget);
      expect(find.widgetWithText(TextButton, RequestsWords.title), findsNothing);
    });

    testWidgets('Requests on an iPad mini upright: the rail, one column, a request pushed as on a phone', (tester) async {
      final people = requestsPeople();
      await boot(tester, people, const Size(744, 1133));
      expect(find.byType(SideNav), findsOneWidget);
      await tester.tap(inNav(ShellWords.requests));
      await tester.pumpAndSettle();
      expect(find.byType(RequestPage), findsNothing);
      final row = historyRowOf(requestOf(RequestKind.permission, permissionJson()));
      await tester.scrollUntilVisible(find.text(row.when), 300, scrollable: find.descendant(of: find.byType(RequestsTab), matching: find.byType(Scrollable)).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text(row.when));
      await tester.pumpAndSettle();
      expect(tester.widget<RequestPage>(find.byType(RequestPage)).inPane, isFalse);
      expect(find.widgetWithText(TextButton, RequestsWords.title), findsOneWidget);
    });

    testWidgets('Attendance: the calendar and the day picked side by side, Today over it; no sheet', (tester) async {
      final people = FakePeople()
        ..on('GET /api/auth/me', (req) => json(meJson()))
        ..on('GET /api/me/attendance/today', (req) => json(todayJson()))
        ..on('GET /api/attendance/me', (req) => json(octoberJson()))
        ..on('GET /api/me/attendance/corrections', (req) => json([attendance.correctionJson()]));
      await boot(tester, people, onItsSide, more: [attendanceClockProvider.overrideWithValue(() => DateTime(2026, 10, 30, 14))]);
      await tester.tap(inNav(ShellWords.attendance));
      await tester.pumpAndSettle();
      // the calendar on the left, the latest day on record so far on the right
      expect(find.byType(CalendarCard), findsOneWidget);
      expect(find.text(AttendanceWords.yourDay.toUpperCase()), findsOneWidget);
      final first = tester.widget<DayDetails>(find.byType(DayDetails)).date;
      expect(first.compareTo('2026-10-30') <= 0, isTrue);
      expect(tester.getRect(find.byType(DayDetails)).left, greaterThan(tester.getRect(find.byType(CalendarCard)).right));

      // another day, picked on the calendar: beside it, no bottom sheet
      await tester.tap(find.descendant(of: find.byType(CalendarCard), matching: find.text('26')));
      await tester.pumpAndSettle();
      expect(tester.widget<DayDetails>(find.byType(DayDetails)).date, '2026-10-26');
      expect(find.text(AttendanceWords.dayTitle('2026-10-26')), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
    });
  });
}
