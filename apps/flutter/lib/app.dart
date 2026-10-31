import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'api/people_client.dart';
import 'auth/auth_controller.dart';
import 'features/assets/my_assets_screen.dart';
import 'features/attendance/attendance_tab.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/kpis/kpi_words.dart';
import 'features/kpis/team_kpis_screen.dart';
import 'features/performance/performance_screen.dart';
import 'features/profile/account_screens.dart';
import 'features/profile/profile_tab.dart';
import 'features/requests/requests_tab.dart';
import 'models/me.dart';
import 'shell/app_shell.dart';
import 'features/sign_in/sign_in_screen.dart';
import 'theme/app_theme.dart';
import 'theme/look.dart';
import 'theme/parts.dart';
import 'theme/tokens.dart';
import 'auth/app_lock.dart';
import 'platform/location_gate.dart';
import 'platform/update_gate.dart';

class PeopleApp extends ConsumerStatefulWidget {
  const PeopleApp({super.key});

  @override
  ConsumerState<PeopleApp> createState() => _PeopleAppState();
}

class _PeopleAppState extends ConsumerState<PeopleApp> {
  /// Changes whenever the sign-in state does, so the router looks again where to be.
  final _signedIn = ValueNotifier<int>(0);

  /// The app's screens and their addresses: the sign-in, and once signed in the phone design's frame with its four
  /// tabs (Dashboard, Requests, Attendance, Profile), each keeping its place; the account's screens, My Assets and the
  /// scorecards under Profile.
  late final _router = GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: _signedIn,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final at = state.matchedLocation;
      if (auth.hasError || !auth.hasValue) return at == '/start' ? null : '/start';
      if (auth.value is! SignedIn) return at == '/sign-in' ? null : '/sign-in';
      if (at == '/start' || at == '/sign-in') return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/start', builder: (context, state) => const AuthGate()),
      GoRoute(path: '/sign-in', builder: (context, state) => const AuthGate()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _SignedIn(
          builder: (me) => AppShell(shell: shell, me: me),
        ),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/dashboard',
                builder: (context, state) => _SignedIn(builder: (me) => DashboardScreen(me: me)),
                routes: [
                  GoRoute(
                    path: 'performance',
                    builder: (context, state) => const PerformanceScreen(),
                    // the scorecards of the people they score (owner, 31 October 2026: "employees and managers can
                    // perform the KPI's from the mobile app"), from the More menu
                    routes: [GoRoute(path: 'team', builder: (context, state) => const TeamKpisScreen(back: KpiWords.myTitle))],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/requests', builder: (context, state) => const RequestsTab())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/attendance', builder: (context, state) => const AttendanceTab())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileTab(),
                routes: [
                  GoRoute(
                    path: 'password',
                    builder: (context, state) => const ChangePasswordScreen(),
                  ),
                  GoRoute(
                    path: 'photo',
                    builder: (context, state) => const ProfilePhotoScreen(),
                  ),
                  GoRoute(
                    path: 'sessions',
                    builder: (context, state) => const SessionsScreen(),
                  ),
                  GoRoute(
                    path: 'interview-hours',
                    builder: (context, state) => const InterviewHoursScreen(),
                  ),
                  // the company's assets they hold (owner, 31 October 2026: "every employee sees his assets")
                  GoRoute(
                    path: 'assets',
                    builder: (context, state) => const MyAssetsScreen(),
                  ),
                  // their scorecards from the Profile's KPIs (owner, 31 October 2026: "replace payslips with the KPI's")
                  GoRoute(
                    path: 'performance',
                    builder: (context, state) => const PerformanceScreen(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );

  @override
  void initState() {
    super.initState();
    ref.listenManual(authProvider, (_, _) => _signedIn.value++);
  }

  @override
  void dispose() {
    _router.dispose();
    _signedIn.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Trendlix People',
      theme: appTheme(Brightness.light),
      darkTheme: appTheme(Brightness.dark),
      themeMode: ref.watch(lookProvider),
      routerConfig: _router,
      debugShowCheckedModeBanner: false,
      // the phone's status bar in the look's colours
      builder: (context, child) {
        final dark = Theme.of(context).brightness == Brightness.dark;
        final bars = (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(statusBarColor: Colors.transparent);
        // behind the fingerprint or face whenever it opens or comes back (owner, 31 October 2026: app_lock.dart); an
        // older build than the newest, only "Update required" (update_gate.dart)
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: bars,
          child: UpdateGate(child: AppLockGate(child: LocationGate(child: child!))),
        );
      },
    );
  }
}

/// A signed-in screen, given who it is; nothing while the router moves away after a sign-out.
class _SignedIn extends ConsumerWidget {
  const _SignedIn({required this.builder});

  final Widget Function(Me me) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider).value;
    return auth is SignedIn ? builder(auth.me) : const SizedBox.shrink();
  }
}

/// Before the frame: while the kept session is checked, a wait; People unreachable, Try again; signed out, sign-in.
class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  static const tryAgain = 'Try again';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    return switch (auth) {
      AsyncData(value: final SignedOut s) => SignInScreen(key: ValueKey(s), state: s),
      AsyncError(:final error) => _Unreachable(message: error is ApiException ? error.message : PeopleClient.unreachableText),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}

class _Unreachable extends ConsumerWidget {
  const _Unreachable({required this.message});

  final String message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: Tokens.pagePadding,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Center(child: IconTile(CupertinoIcons.wifi_slash, onCard: false)),
              const SizedBox(height: Tokens.gap),
              Text(message, textAlign: TextAlign.center, style: text.titleMedium),
              const SizedBox(height: Tokens.gap * 1.5),
              FilledButton(onPressed: () => ref.invalidate(authProvider), child: const Text(AuthGate.tryAgain)),
            ],
          ),
        ),
      ),
    );
  }
}
