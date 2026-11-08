import 'dart:ui' show ImageFilter;

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/people_client.dart';
import '../auth/auth_controller.dart';
import '../auth/unlock_words.dart';
import '../features/about/diagnostics.dart' show versionLineOf;
import '../features/kpis/kpi_reminder.dart';
import '../features/manual_changes/manual_changes.dart';
import '../features/requests/waiting_popup.dart';
import '../features/timesheet/timesheet_data.dart';
import '../features/review/review_gate.dart';
import '../format.dart';
import '../models/me.dart';
import '../providers.dart';
import '../theme/look.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import '../theme/wide.dart';
import 'notifications.dart';
import 'push_listener.dart';
import 'shell_words.dart';
import 'side_nav.dart';

// The app's frame, from the phone design (Figma "Mobile Flutter App", 30 October 2026): the header (the wordmark's
// tile, the sun/moon, the bell, the avatar that opens the account's menu), the tab's page, and the floating, frosted tab
// bar at the bottom: Dashboard, Requests, Attendance, Profile, and More, which opens the menu. On an iPad (7 November 2026)
// the header and the page keep to a column in the middle and the tab bar to its own width (wide.dart). Since 8 November
// 2026 (owner: "i think the Ipad needs a better layout with some more features available due to the larger screen") a
// wide window has the rail or the sidebar on the left instead (side_nav.dart: the tabs and the More menu's places), the
// sun/moon and the bell over the page; a phone, or a narrow window on an iPad, keeps the tab bar.

/// The four tabs with pages, in the bar's order (More is the menu, not a page).
const shellTabs = ['/dashboard', '/requests', '/attendance', '/profile'];

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key, required this.shell, required this.me, this.location = ''});

  final StatefulNavigationShell shell;
  final Me me;

  /// The page's address, for the place the iPad's rail or sidebar marks.
  final String location;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _offerFingerprint();
      // notifications on this phone, asked once, and the push that opened the app (8 November 2026): its page first
      final pushed = mounted && await startPush(context, ref);
      // KPI scorecards waiting: once a sign-in, unless postponed (1 November 2026)
      if (mounted) await remindKpis(context, ref);
      // changes made by hand by someone they manage, until marked seen (4 November 2026)
      if (mounted) await showManualChanges(context, ref);
      // requests waiting for their approval (8 November 2026), unless a push already opened one
      if (mounted && !pushed) await showWaitingPopup(context, ref, userId: widget.me.id);
    });
  }

  /// Right after a password sign-in on a phone that could use the fingerprint: asked once.
  Future<void> _offerFingerprint() async {
    final auth = ref.read(authProvider.notifier);
    final s = ref.read(authProvider).value;
    if (s is! SignedIn || !s.offerFingerprint || !mounted) return;
    auth.fingerprintOffered();
    // Face ID or Touch ID on an iPhone or iPad, the fingerprint on Android (unlock_words.dart)
    final words = UnlockWords(await ref.read(unlockKindProvider.future));
    if (!mounted) return;
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: Icon(words.icon, size: 40),
        title: Text(words.offerTitle),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(ShellWords.offerNo)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(words.offerYes)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (await auth.turnOnFingerprint()) messenger.showSnackBar(SnackBar(content: Text(words.turnedOn)));
    } on FingerprintProblem catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _go(int index) => widget.shell.goBranch(index, initialLocation: index == widget.shell.currentIndex);

  /// The frame, under what listens for notifications while signed in (push_listener.dart), the same on a phone and on an
  /// iPad whichever way it turns.
  @override
  Widget build(BuildContext context) => PushListener(userId: widget.me.id, child: Builder(builder: _frame));

  Widget _frame(BuildContext context) {
    final layout = navLayoutOf(MediaQuery.sizeOf(context));
    if (layout != NavLayout.phone) return _wide(context, layout);
    final bottom = MediaQuery.paddingOf(context).bottom;
    final theme = Theme.of(context);
    // a message (a SnackBar) shows above the floating tab bar, never over it
    return Theme(
      data: theme.copyWith(snackBarTheme: theme.snackBarTheme.copyWith(insetPadding: centredPadding(context, EdgeInsets.fromLTRB(16, 0, 16, 96 + bottom)))),
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
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: Tokens.tabBarMaxWidth),
                    child: TabBarFloating(current: widget.shell.currentIndex, onTab: _go, onMore: () => showMoreMenu(context, widget.me)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// An iPad's frame (8 November 2026): the rail or the sidebar, and beside it the sun/moon and the bell over the tab's
  /// page. The page is told its own width (what it centres in) and that no tab bar covers its foot (wide.dart); a message
  /// shows at the foot of the page, in its middle.
  Widget _wide(BuildContext context, NavLayout layout) {
    final window = MediaQuery.of(context);
    final aside = layout == NavLayout.rail ? Tokens.railWidth : Tokens.sidebarWidth;
    final page = window.copyWith(
      size: Size(window.size.width - aside, window.size.height),
      padding: window.padding.copyWith(left: 0),
      viewPadding: window.viewPadding.copyWith(left: 0),
    );
    return ReviewGate(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SideNav(layout: layout, me: widget.me, location: widget.location, onTab: _go),
          Expanded(
            child: MediaQuery(
              data: page,
              child: NavScope(
                layout: layout,
                child: Builder(
                  builder: (context) {
                    final theme = Theme.of(context);
                    final inset = centredPadding(context, EdgeInsets.fromLTRB(16, 0, 16, 16 + page.padding.bottom), max: Tokens.noticeMaxWidth);
                    return Theme(
                      data: theme.copyWith(snackBarTheme: theme.snackBarTheme.copyWith(insetPadding: inset)),
                      child: Scaffold(
                        body: SafeArea(
                          bottom: false,
                          left: false,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              const _WideBar(),
                              Expanded(child: widget.shell),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Over an iPad's page: the sun/moon and the bell, on the right, as the website's header has them.
class _WideBar extends ConsumerWidget {
  const _WideBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.line))),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          IconButton(
            tooltip: p.isDark ? ShellWords.toLight : ShellWords.toDark,
            onPressed: () => ref.read(lookProvider.notifier).toggle(p.brightness),
            icon: Icon(p.isDark ? CupertinoIcons.sun_max : CupertinoIcons.moon, size: 21, color: p.ink),
          ),
          const Bell(),
        ],
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
      padding: centredPadding(context, const EdgeInsets.fromLTRB(20, 14, 16, 6)),
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
                    // the places as the iPad's rail and sidebar list them too (side_nav.dart morePlaces, 8 November 2026)
                    for (final place in morePlaces(me, logsHours: me.employeeId != null && ref.watch(logsHoursProvider).value == true))
                      _MenuRow(icon: place.icon, label: place.label, onTap: () => go(place.path)),
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

/// The room a tab's page leaves at its foot for the tab bar; on an iPad, its column in the middle, at most [max] wide
/// (beside the rail or the sidebar, no tab bar to leave room for: 8 November 2026).
EdgeInsets tabPagePadding(BuildContext context, {double max = Tokens.pageMaxWidth}) => centredPadding(
  context,
  Tokens.pagePadding.copyWith(bottom: (hasTabBar(context) ? Tokens.underTabBar : Tokens.pagePadding.bottom) + MediaQuery.paddingOf(context).bottom),
  max: max,
);
