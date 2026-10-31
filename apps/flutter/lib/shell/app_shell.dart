import 'dart:ui' show ImageFilter;

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/people_client.dart';
import '../auth/auth_controller.dart';
import '../features/about/diagnostics.dart' show AboutWords, versionLineOf;
import '../features/kpis/kpi_words.dart' show KpiWords;
import '../features/review/review_gate.dart';
import '../format.dart';
import '../models/me.dart';
import '../providers.dart';
import '../theme/look.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import 'notifications.dart';
import 'shell_words.dart';

// The app's frame, from the phone design (Figma "Mobile Flutter App", 30 October 2026): the header (the wordmark's
// tile, the sun/moon, the bell, the avatar that opens the account's menu), the tab's page, and the floating, frosted tab
// bar at the bottom: Dashboard, Requests, Attendance, Profile, and More, which opens the menu.

/// The four tabs with pages, in the bar's order (More is the menu, not a page).
const shellTabs = ['/dashboard', '/requests', '/attendance', '/profile'];

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key, required this.shell, required this.me});

  final StatefulNavigationShell shell;
  final Me me;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _offerFingerprint());
  }

  /// Right after a password sign-in on a phone that could use the fingerprint: asked once.
  Future<void> _offerFingerprint() async {
    final auth = ref.read(authProvider.notifier);
    final s = ref.read(authProvider).value;
    if (s is! SignedIn || !s.offerFingerprint || !mounted) return;
    auth.fingerprintOffered();
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.fingerprint_rounded, size: 40),
        title: const Text(ShellWords.offerTitle),
        content: const Text(ShellWords.offerBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(ShellWords.offerNo)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(ShellWords.offerYes)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (await auth.turnOnFingerprint()) messenger.showSnackBar(const SnackBar(content: Text(ShellWords.fingerprintOn)));
    } on FingerprintProblem catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _go(int index) => widget.shell.goBranch(index, initialLocation: index == widget.shell.currentIndex);

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final theme = Theme.of(context);
    // a message (a SnackBar) shows above the floating tab bar, never over it
    return Theme(
      data: theme.copyWith(snackBarTheme: theme.snackBarTheme.copyWith(insetPadding: EdgeInsets.fromLTRB(16, 0, 16, 96 + bottom))),
      // Review your details first while it waits (owner, 31 October 2026: "make the data review obligatory upon the signin
      // for employees")
      child: ReviewGate(
        child: Scaffold(
          body: Stack(
            children: [
              SafeArea(
                bottom: false,
                child: Column(
                  children: [
                    AppHeader(me: widget.me),
                    Expanded(child: widget.shell),
                  ],
                ),
              ),
              Positioned(
                left: 12,
                right: 12,
                bottom: 12 + bottom,
                child: TabBarFloating(current: widget.shell.currentIndex, onTab: _go, onMore: () => showMoreMenu(context, widget.me)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The design's header: the wordmark in its white tile; the sun/moon, the bell and the avatar on the right.
class AppHeader extends ConsumerWidget {
  const AppHeader({super.key, required this.me});

  final Me me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 16, 6),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(13),
              border: Border.all(color: p.line),
            ),
            child: const Wordmark(height: 8, forDark: false),
          ),
          const Spacer(),
          IconButton(
            tooltip: p.isDark ? ShellWords.toLight : ShellWords.toDark,
            onPressed: () => ref.read(lookProvider.notifier).toggle(p.brightness),
            icon: Icon(p.isDark ? CupertinoIcons.sun_max : CupertinoIcons.moon, size: 21, color: p.ink),
          ),
          const Bell(),
          const SizedBox(width: 4),
          Tooltip(
            message: ShellWords.account,
            child: InkResponse(
              onTap: () => showMoreMenu(context, me),
              radius: 24,
              child: Container(
                width: 44,
                height: 44,
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: p.line),
                ),
                child: Container(
                  alignment: Alignment.center,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: p.primary),
                  child: Text(
                    initialsOf(me.name ?? me.firstName),
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(color: p.onPrimary, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The floating tab bar: frosted over the page (blurred, lightly tinted), a thin line round it; the current tab a light
/// pill with dark words, the others grey (Figma: 72 high, 22 corners, 12 from the edges).
class TabBarFloating extends StatelessWidget {
  const TabBarFloating({super.key, required this.current, required this.onTab, required this.onMore});

  final int current;
  final ValueChanged<int> onTab;
  final VoidCallback onMore;

  static const items = [
    (ShellWords.dashboard, CupertinoIcons.square_grid_2x2),
    (ShellWords.requests, CupertinoIcons.doc_text),
    (ShellWords.attendance, CupertinoIcons.calendar),
    (ShellWords.profile, CupertinoIcons.person),
    (ShellWords.more, CupertinoIcons.ellipsis),
  ];

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [BoxShadow(color: Color(0x4D000000), offset: Offset(0, 18), blurRadius: 50)],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(22),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            height: 72,
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: p.tabTint,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: p.tabStroke),
            ),
            child: Row(
              children: [
                for (final (i, (label, icon)) in items.indexed)
                  Expanded(
                    child: _Tab(label: label, icon: icon, on: i == current, onTap: i == items.length - 1 ? onMore : () => onTab(i)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.icon, required this.on, required this.onTap});

  final String label;
  final IconData icon;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final colour = on ? const Color(0xFF111110) : p.tabInactive;
    return Semantics(
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Tokens.radiusTile),
          child: Ink(
            decoration: BoxDecoration(color: on ? p.tabActive : Colors.transparent, borderRadius: BorderRadius.circular(Tokens.radiusTile)),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 18, color: colour),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(label, maxLines: 1, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colour, fontSize: 12)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The account's menu (the More tab and the avatar): who is signed in, and the ways to their profile and account.
Future<void> showMoreMenu(BuildContext context, Me me) {
  final router = GoRouter.of(context);
  return showModalBottomSheet<void>(
    context: context,
    // over the tab bar and as tall as it needs (owner, 31 October 2026, the menu cut off at Team KPIs: "is there a
    // signout button in the app?"): the rows scroll when they don't fit, Sign out stays at the foot
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) {
      final p = context.palette;
      final text = Theme.of(context).textTheme;
      void go(String path) {
        Navigator.of(context).pop();
        router.go(path);
      }

      return Consumer(
        builder: (context, ref, _) => Container(
          margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
          decoration: BoxDecoration(
            color: p.card,
            borderRadius: BorderRadius.circular(Tokens.radiusCard),
            border: Border.all(color: p.line),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: p.raised,
                      border: Border.all(color: p.line),
                    ),
                    child: Text(initialsOf(me.name ?? me.firstName), style: text.labelMedium?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(me.name ?? me.firstName, style: text.bodyLarge),
                        Text(me.email, style: text.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Divider(color: p.line),
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                    if (me.employeeId != null) ...[
                      _MenuRow(icon: CupertinoIcons.person, label: ShellWords.viewProfile, onTap: () => go('/profile')),
                      _MenuRow(icon: CupertinoIcons.person_crop_square, label: ShellWords.changePhoto, onTap: () => go('/profile/photo')),
                      // what the company handed them (owner, 31 October 2026: "every employee sees his assets")
                      _MenuRow(icon: CupertinoIcons.cube_box, label: ShellWords.assets, onTap: () => go('/profile/assets')),
                    ],
                    _MenuRow(icon: CupertinoIcons.lock, label: ShellWords.password, onTap: () => go('/profile/password')),
                    _MenuRow(icon: CupertinoIcons.device_phone_portrait, label: ShellWords.devices, onTap: () => go('/profile/sessions')),
                    if (me.employeeId != null) _MenuRow(icon: CupertinoIcons.clock, label: ShellWords.hiring, onTap: () => go('/profile/interview-hours')),
                    // their people's KPI scorecards to score and sign (owner, 31 October 2026), as the website offers Team KPIs
                    if (me.scoresTeam) _MenuRow(icon: CupertinoIcons.person_2, label: KpiWords.teamTitle, onTap: () => go('/dashboard/performance/team')),
                    // the app's version and what helps find a problem (owner, 31 October 2026)
                    _MenuRow(icon: CupertinoIcons.info, label: AboutWords.menu, onTap: () => go('/profile/about')),
                    ],
                  ),
                ),
              ),
              Divider(color: p.line),
              _MenuRow(
                icon: CupertinoIcons.square_arrow_left,
                label: ShellWords.signOut,
                onTap: () {
                  Navigator.of(context).pop();
                  ref.read(authProvider.notifier).signOut();
                },
              ),
              // the running version, always in sight (owner, 31 October 2026: "display the running app version in the more
              // menu"); a tap opens About this app
              Builder(
                builder: (context) {
                  final config = ref.read(configProvider);
                  return InkWell(
                    onTap: () => go('/profile/about'),
                    borderRadius: BorderRadius.circular(Tokens.radiusControl),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(versionLineOf(config.version, config.build), textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: p.muted)),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Tokens.radiusControl),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Row(
          children: [
            Icon(icon, size: 19, color: p.muted),
            const SizedBox(width: 14),
            Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyLarge)),
            Icon(CupertinoIcons.arrow_right, size: 16, color: p.muted),
          ],
        ),
      ),
    );
  }
}

/// The room a tab's page leaves at its foot for the tab bar.
EdgeInsets tabPagePadding(BuildContext context) => Tokens.pagePadding.copyWith(bottom: Tokens.underTabBar + MediaQuery.paddingOf(context).bottom);
