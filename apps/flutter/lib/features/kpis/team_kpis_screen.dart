import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/kpi.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'kpi_data.dart';
import 'kpi_parts.dart';
import 'kpi_words.dart';
import 'scorecard_screen.dart';

// Team KPIs (owner's brief, 21 October 2026: "Team KPIs (managers): their people's scorecards to score"; 31 October
// 2026: "employees and managers can perform the KPI's from the mobile app"), as the website's Team KPIs has it
// (apps/web kpis/team/page.tsx): the scorecards waiting for the caller to score or to sign as the manager, and a month's
// scorecards of the people they score (the person in charge: direct manager, else team lead, else head of department;
// the CEO the C-level people's), the month chosen among the team overview's. The API answers for the caller alone.
// The website's heatmap and level distribution stay there.

class TeamKpisScreen extends ConsumerStatefulWidget {
  const TeamKpisScreen({super.key, this.back = KpiWords.back});

  /// The page it goes back to.
  final String back;

  @override
  ConsumerState<TeamKpisScreen> createState() => _TeamKpisScreenState();
}

class _TeamKpisScreenState extends ConsumerState<TeamKpisScreen> {
  /// The month asked for (YYYY-MM); null: the overview's newest, else last month.
  String? _month;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider).value;
    final myEmployee = auth is SignedIn ? auth.me.employeeId : null;
    final waiting = ref.watch(kpiWaitingProvider);
    // those the caller scores or signs as their manager (teamWaiting): HR's calibrations are on the website
    final mine = [
      for (final s in waiting.value ?? const <KpiScorecard>[])
        if ((s.action == 'score' || s.action == 'sign') && s.employee?.id != myEmployee) s,
    ];
    final months = ref.watch(teamMonthsProvider).value ?? const <String>[];
    final month = _month ?? (months.isNotEmpty ? months.last : scorecardMonthOn(isoDayOf(DateTime.now())));
    final choices = {month, ...months}.toList()..sort((a, b) => b.compareTo(a));
    final cards = ref.watch(teamScorecardsProvider(month));

    void open(KpiScorecard s) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ScorecardScreen(id: s.id, back: KpiWords.teamTitle)));

    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(kpiWaitingProvider)
            ..invalidate(teamMonthsProvider)
            ..invalidate(teamScorecardsProvider(month));
          await ref.read(teamScorecardsProvider(month).future).catchError((_) => const <KpiScorecard>[]);
        },
        child: ListView(
          padding: tabPagePadding(context).copyWith(top: 4),
          children: [
            KpiBack(widget.back),
            const SizedBox(height: 6),
            const PageHead(eyebrow: KpiWords.eyebrow, title: KpiWords.teamTitle, intro: KpiWords.teamIntro),
            const SizedBox(height: 24),
            if (mine.isNotEmpty) ...[
              SurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    CardHead(eyebrow: KpiWords.yourTurn, title: KpiWords.waitingForYou, trailing: Pill('${mine.length}', strong: true)),
                    const SizedBox(height: 6),
                    Text(KpiWords.teamWaitingIntro, style: text.bodySmall),
                    const SizedBox(height: 6),
                    for (final (i, s) in mine.indexed) ...[
                      if (i > 0) Divider(height: 1, color: p.line),
                      KpiScorecardRow(card: s, title: s.employee?.fullNameEn ?? '', subtitle: waitingLine(s), button: actionButton(s), onTap: () => open(s)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (waiting.hasError) ...[
              KpiLoadFailed(text: KpiWords.teamNotLoaded, onRetry: () => ref.invalidate(kpiWaitingProvider)),
              const SizedBox(height: 12),
            ],
            SurfaceCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(KpiWords.scorecardsOf(monthNameOf(month)), style: text.titleLarge),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    // made again when the month shown changes (the overview's months arrive after the page opens)
                    key: ValueKey(month),
                    initialValue: month,
                    decoration: const InputDecoration(labelText: KpiWords.month),
                    items: [for (final m in choices) DropdownMenuItem(value: m, child: Text(monthNameOf(m)))],
                    onChanged: (m) => setState(() => _month = m),
                  ),
                  const SizedBox(height: 8),
                  switch (cards) {
                    AsyncValue(value: final List<KpiScorecard> list) when list.isEmpty => Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(KpiWords.noTeamScorecards(monthNameOf(month)), style: text.bodyMedium?.copyWith(color: p.muted)),
                    ),
                    AsyncValue(value: final List<KpiScorecard> list) => Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final (i, s) in list.indexed) ...[
                          if (i > 0) Divider(height: 1, color: p.line),
                          KpiScorecardRow(
                            card: s,
                            title: s.employee?.fullNameEn ?? '',
                            subtitle: teamLine(s),
                            button: s.action == null ? null : actionButton(s),
                            onTap: () => open(s),
                          ),
                        ],
                        const SizedBox(height: 6),
                        Text('${KpiWords.scorecardsCount(list.length)}.', style: text.bodySmall),
                      ],
                    ),
                    AsyncError() => KpiLoadFailed(text: KpiWords.teamNotLoaded, onRetry: () => ref.invalidate(teamScorecardsProvider(month))),
                    _ => const KpiLoading(),
                  },
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
