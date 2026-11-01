import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../models/kpi.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart' show myKpisProvider;
import 'kpi_data.dart';
import 'kpi_parts.dart';
import 'kpi_words.dart';
import 'scorecard_screen.dart';
import 'team_kpis_screen.dart';

// My KPIs (owner, 21 October 2026: "Self, manager, HR, sign-off"; 31 October 2026: "employees and managers can perform
// the KPI's from the mobile app"), as the website's My KPIs has it (apps/web kpis/mine-ui.tsx): what waits for the
// employee on their own scorecards (to rate themself, to sign), their scorecards month by month with the final % once
// it is shown to them (from the sign-off). For those who score a team's, the way to Team KPIs, with how many wait for
// them. Each scorecard opens its page, where the step is taken.

class MyKpisScreen extends ConsumerWidget {
  const MyKpisScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    final cards = ref.watch(myKpisProvider);
    final waiting = ref.watch(kpiWaitingProvider);
    final own = [
      for (final s in waiting.value ?? const <KpiScorecard>[])
        if (s.action != null && me?.employeeId != null && s.employee?.id == me!.employeeId) s,
    ];
    final scoresTeam = me?.scoresTeam ?? false;
    final counts = scoresTeam ? ref.watch(kpiCountsProvider).value : null;

    void open(KpiScorecard s) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ScorecardScreen(id: s.id)));

    return Scaffold(
      backgroundColor: context.palette.canvas,
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(myKpisProvider)
            ..invalidate(kpiWaitingProvider)
            ..invalidate(kpiCountsProvider);
          await ref.read(myKpisProvider.future);
        },
        child: ListView(
          padding: tabPagePadding(context).copyWith(top: 4),
          children: [
            const KpiBack(KpiWords.back),
            const SizedBox(height: 6),
            const PageHead(eyebrow: KpiWords.eyebrow, title: KpiWords.myTitle),
            const SizedBox(height: 24),
            if (scoresTeam) ...[
              SurfaceCard(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4),
                child: ListRow(
                  icon: CupertinoIcons.person_2,
                  title: KpiWords.teamTitle,
                  subtitle: counts != null && counts.team > 0 ? KpiWords.teamWaitingOf(counts.team) : null,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const TeamKpisScreen(back: KpiWords.myTitle))),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (own.isNotEmpty) ...[_Waiting(cards: own, onOpen: open), const SizedBox(height: 12)],
            switch (cards) {
              AsyncValue(value: final List<KpiScorecard> list) when list.isEmpty => const _NoneYet(),
              AsyncValue(value: final List<KpiScorecard> list) => _History(cards: list, onOpen: open),
              AsyncError() => KpiLoadFailed(text: KpiWords.notLoaded, onRetry: () => ref.invalidate(myKpisProvider)),
              _ => const KpiLoading(),
            },
          ],
        ),
      ),
    );
  }
}

/// What waits for the employee on their own scorecards: to rate themself, or to sign.
class _Waiting extends StatelessWidget {
  const _Waiting({required this.cards, required this.onOpen});

  final List<KpiScorecard> cards;
  final ValueChanged<KpiScorecard> onOpen;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const CardHead(eyebrow: KpiWords.yourTurn, title: KpiWords.waitingForYou),
          for (final s in cards) ...[
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IconTile(s.action == 'sign' ? CupertinoIcons.signature : CupertinoIcons.checkmark_square),
                const SizedBox(width: 12),
                Expanded(child: Text(ownCardText(s), style: text.bodyLarge)),
              ],
            ),
            const SizedBox(height: 10),
            FilledButton(onPressed: () => onOpen(s), child: Text(actionButton(s))),
          ],
        ],
      ),
    );
  }
}

/// Every month's scorecard, newest first: the final % and level once shown, else the step.
class _History extends StatelessWidget {
  const _History({required this.cards, required this.onOpen});

  final List<KpiScorecard> cards;
  final ValueChanged<KpiScorecard> onOpen;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const CardHead(eyebrow: KpiWords.yourScorecards, title: KpiWords.history),
          const SizedBox(height: 6),
          for (final (i, k) in cards.indexed) ...[
            if (i > 0) Divider(height: 1, color: p.line),
            KpiScorecardRow(card: k, title: monthTitle(k), subtitle: historyLine(k), button: k.action == null ? null : actionButton(k), onTap: () => onOpen(k)),
          ],
        ],
      ),
    );
  }
}

/// No scorecard yet.
class _NoneYet extends StatelessWidget {
  const _NoneYet();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow('No scorecards yet'),
          const SizedBox(height: 8),
          Text(KpiWords.noneTitle, style: text.titleLarge),
        ],
      ),
    );
  }
}
