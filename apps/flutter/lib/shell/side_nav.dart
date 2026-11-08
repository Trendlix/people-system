import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../features/about/diagnostics.dart' show AboutWords, versionLineOf;
import '../features/kpis/kpi_words.dart' show KpiWords;
import '../features/timesheet/timesheet_data.dart';
import '../features/timesheet/timesheet_words.dart';
import '../format.dart';
import '../models/me.dart';
import '../providers.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import '../theme/wide.dart';
import 'shell_words.dart';

// The iPad's navigation (owner, 8 November 2026: "i think the Ipad needs a better layout with some more features
// available due to the larger screen"): in place of the floating tab bar, a column on the left as the website's side menu
// (near-black, its items grey, the page's a light pill): the four tabs, then what the More menu holds, each one tap away
// (their KPIs, their team's, their timesheet, their assets; their photo, password, devices, hiring hours, About), who is
// signed in and Sign out. On its side, the sidebar with the words in full; upright, the rail, each an icon with a short
// word (wide.dart says when). The More menu and this read one list (morePlaces), so each shows the same places to the same
// people.

/// The iPad navigation's own words, in one place (ready for Arabic); the places keep the More menu's names.
abstract final class SideNavWords {
  static const workspace = 'Workspace';
  static const account = 'Account';
  static const navigation = 'Main';

  /// The rail's short words, under each icon.
  static const dashboard = 'Home';
  static const myKpis = 'KPIs';
  static const teamKpis = 'Team';
  static const timesheet = 'Hours';
  static const assets = 'Assets';
  static const photo = 'Photo';
  static const password = 'Password';
  static const devices = 'Devices';
  static const hiring = 'Hiring';
  static const about = 'About';
  static const signOut = 'Sign out';
}

/// A place the More menu opens (and the iPad's rail and sidebar): its icon, its name, the rail's short word, its
/// address, and whether it is the account's (the sidebar's second group) rather than the person's work.
typedef MorePlace = ({IconData icon, String label, String short, String path, bool account});

/// What the More menu holds for [me], in its order; [logsHours]: on timesheets.
List<MorePlace> morePlaces(Me me, {required bool logsHours}) => [
  if (me.employeeId != null) ...[
    (icon: CupertinoIcons.person, label: ShellWords.viewProfile, short: ShellWords.profile, path: '/profile', account: true),
    (icon: CupertinoIcons.person_crop_square, label: ShellWords.changePhoto, short: SideNavWords.photo, path: '/profile/photo', account: true),
    // what the company handed them (owner, 31 October 2026: "every employee sees his assets")
    (icon: CupertinoIcons.cube_box, label: ShellWords.assets, short: SideNavWords.assets, path: '/profile/assets', account: false),
  ],
  (icon: CupertinoIcons.lock, label: ShellWords.password, short: SideNavWords.password, path: '/profile/password', account: true),
  (icon: CupertinoIcons.device_phone_portrait, label: ShellWords.devices, short: SideNavWords.devices, path: '/profile/sessions', account: true),
  if (me.employeeId != null)
    (icon: CupertinoIcons.clock, label: ShellWords.hiring, short: SideNavWords.hiring, path: '/profile/interview-hours', account: true),
  // their people's KPI scorecards to score and sign (owner, 31 October 2026), as the website offers Team KPIs
  // their own KPIs, easy to find (owner, 2 November 2026: "the employees cant find the KPIs in the app")
  if (me.employeeId != null)
    (icon: CupertinoIcons.graph_square, label: KpiWords.myTitle, short: SideNavWords.myKpis, path: '/dashboard/performance', account: false),
  if (me.scoresTeam)
    (icon: CupertinoIcons.person_2, label: KpiWords.teamTitle, short: SideNavWords.teamKpis, path: '/dashboard/performance/team', account: false),
  // their hours, for those on timesheets only (owner, 4 November 2026)
  if (me.employeeId != null && logsHours)
    (icon: CupertinoIcons.timer, label: TimesheetWords.menu, short: SideNavWords.timesheet, path: '/dashboard/timesheet', account: false),
  // the app's version and what helps find a problem (owner, 31 October 2026)
  (icon: CupertinoIcons.info, label: AboutWords.menu, short: SideNavWords.about, path: '/profile/about', account: true),
];

/// The four tabs as the rail and the sidebar list them: icon, name, short word, address.
const _tabs = [
  (CupertinoIcons.square_grid_2x2, ShellWords.dashboard, SideNavWords.dashboard, '/dashboard'),
  (CupertinoIcons.doc_text, ShellWords.requests, ShellWords.requests, '/requests'),
  (CupertinoIcons.calendar, ShellWords.attendance, ShellWords.attendance, '/attendance'),
  (CupertinoIcons.person, ShellWords.profile, ShellWords.profile, '/profile'),
];

/// Which of [paths] the page at [location] is under: the longest that is it or holds it ("/dashboard/performance/team"
/// is Team KPIs, not My KPIs nor the Dashboard).
String? currentPlaceOf(String location, Iterable<String> paths) {
  String? best;
  for (final p in paths) {
    if ((location == p || location.startsWith('$p/')) && (best == null || p.length > best.length)) best = p;
  }
  return best;
}

/// The rail or the sidebar: [current] the tab shown, [location] the page's address (for the place it is under).
class SideNav extends ConsumerWidget {
  const SideNav({super.key, required this.layout, required this.me, required this.location, required this.onTab});

  final NavLayout layout;
  final Me me;
  final String location;
  final ValueChanged<int> onTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logsHours = me.employeeId != null && ref.watch(logsHoursProvider).value == true;
    final more = [
      for (final p in morePlaces(me, logsHours: logsHours))
        if (p.path != '/profile') p,
    ];
    final here = currentPlaceOf(location, [for (final t in _tabs) t.$4, for (final p in more) p.path]);
    final router = GoRouter.of(context);
    final rail = layout == NavLayout.rail;
    final items = <Widget>[
      if (!rail) const _GroupHead(SideNavWords.workspace),
      for (final (i, (icon, label, short, path)) in _tabs.indexed)
        _Item(rail: rail, icon: icon, label: label, short: short, on: here == path, onTap: () => onTab(i)),
      for (final p in more.where((p) => !p.account))
        _Item(rail: rail, icon: p.icon, label: p.label, short: p.short, on: here == p.path, onTap: () => router.go(p.path)),
      if (rail) const _RailLine() else const _GroupHead(SideNavWords.account, top: 18),
      for (final p in more.where((p) => p.account))
        _Item(rail: rail, icon: p.icon, label: p.label, short: p.short, on: here == p.path, onTap: () => router.go(p.path)),
    ];
    void signOut() => ref.read(authProvider.notifier).signOut();
    return Material(
      color: SidebarLook.background,
      child: Container(
        width: rail ? Tokens.railWidth : Tokens.sidebarWidth,
        decoration: const BoxDecoration(border: Border(right: BorderSide(color: SidebarLook.line))),
        child: SafeArea(
          right: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: rail ? const EdgeInsets.fromLTRB(0, 18, 0, 14) : const EdgeInsets.fromLTRB(20, 22, 16, 20),
                child: rail ? const Center(child: _BrandTile()) : const _Brand(),
              ),
              Expanded(
                child: Semantics(
                  container: true,
                  explicitChildNodes: true,
                  label: SideNavWords.navigation,
                  child: ListView(padding: EdgeInsets.symmetric(horizontal: rail ? 8 : 12), children: items),
                ),
              ),
              Container(height: 1, color: SidebarLook.line),
              Padding(
                padding: EdgeInsets.fromLTRB(rail ? 8 : 12, 10, rail ? 8 : 12, 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Person(me: me, rail: rail, onTap: () => onTab(3)),
                    _Item(rail: rail, icon: CupertinoIcons.square_arrow_left, label: ShellWords.signOut, short: SideNavWords.signOut, on: false, onTap: signOut),
                    if (!rail) _Version(onTap: () => router.go('/profile/about')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The wordmark in its white tile, "Trendlix" and "People System", on the dark side menu.
class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        const _BrandTile(),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Trendlix', style: text.titleSmall?.copyWith(color: SidebarLook.ink, fontWeight: FontWeight.w600, height: 1.2)),
              Text('People System', style: text.bodySmall?.copyWith(color: SidebarLook.text, height: 1.25)),
            ],
          ),
        ),
      ],
    );
  }
}

class _BrandTile extends StatelessWidget {
  const _BrandTile();

  @override
  Widget build(BuildContext context) => Container(
    width: 42,
    height: 42,
    padding: const EdgeInsets.symmetric(horizontal: 6),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
    child: const Wordmark(height: 8, forDark: false),
  );
}

/// The small capitals over a group ("WORKSPACE", "ACCOUNT").
class _GroupHead extends StatelessWidget {
  const _GroupHead(this.text, {this.top = 0});

  final String text;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(12, top, 12, 8),
    child: Text(text.toUpperCase(), semanticsLabel: text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: SidebarLook.quiet)),
  );
}

class _RailLine extends StatelessWidget {
  const _RailLine();

  @override
  Widget build(BuildContext context) => Container(height: 1, margin: const EdgeInsets.fromLTRB(16, 8, 16, 8), color: SidebarLook.line);
}

/// A place: in the sidebar a row (its icon and name, the page's a light pill), in the rail its icon in a pill with its
/// short word under it (the name said in full to a screen reader and on a long press).
class _Item extends StatelessWidget {
  const _Item({required this.rail, required this.icon, required this.label, required this.short, required this.on, required this.onTap});

  final bool rail;
  final IconData icon;
  final String label;
  final String short;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final fg = on ? SidebarLook.onActive : SidebarLook.text;
    final Widget body;
    if (rail) {
      body = InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        hoverColor: SidebarLook.hover,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 52,
                height: 32,
                decoration: BoxDecoration(color: on ? SidebarLook.active : Colors.transparent, borderRadius: BorderRadius.circular(Tokens.radiusPill)),
                child: Icon(icon, size: 19, color: fg),
              ),
              const SizedBox(height: 4),
              Text(
                short,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: text.labelSmall?.copyWith(color: on ? SidebarLook.ink : SidebarLook.text, fontSize: 11.5, letterSpacing: 0, fontWeight: on ? FontWeight.w600 : FontWeight.w400),
              ),
            ],
          ),
        ),
      );
    } else {
      body = Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Material(
          color: on ? SidebarLook.active : Colors.transparent,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(11),
            hoverColor: SidebarLook.hover,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    Icon(icon, size: 18, color: fg),
                    const SizedBox(width: 12),
                    Expanded(child: Text(label, style: text.bodyMedium?.copyWith(color: fg, fontSize: 14))),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      child: rail ? Tooltip(message: label, child: body) : body,
    );
  }
}

/// Who is signed in: their initials, and in the sidebar their name and email; it opens their profile.
class _Person extends StatelessWidget {
  const _Person({required this.me, required this.rail, required this.onTap});

  final Me me;
  final bool rail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final name = me.name ?? me.firstName;
    final avatar = Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: const BoxDecoration(shape: BoxShape.circle, color: SidebarLook.active),
      child: Text(initialsOf(name), style: text.labelMedium?.copyWith(color: SidebarLook.onActive, fontWeight: FontWeight.w600)),
    );
    return Semantics(
      button: true,
      label: '${ShellWords.account}: $name, ${me.email}',
      excludeSemantics: true,
      child: Tooltip(
        message: rail ? name : ShellWords.viewProfile,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Tokens.radiusControl),
          hoverColor: SidebarLook.hover,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: rail ? 0 : 6, vertical: 8),
            child: rail
                ? Center(child: avatar)
                : Row(
                    children: [
                      avatar,
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodyMedium?.copyWith(color: SidebarLook.ink, fontSize: 14)),
                            Text(me.email, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodySmall?.copyWith(color: SidebarLook.text, fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// The running version, as the More menu shows it; a tap opens About this app.
class _Version extends ConsumerWidget {
  const _Version({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.read(configProvider);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Tokens.radiusControl),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          versionLineOf(config.version, config.build),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SidebarLook.quiet, fontSize: 12),
        ),
      ),
    );
  }
}
