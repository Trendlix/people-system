import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/people_client.dart';
import '../../models/kpi.dart';
import '../../providers.dart';
import 'scorecard_screen.dart';

// KPI Scoring Pending in the app (owner, 1 November 2026: "when there is a KPI Scoring Pending make it in a floater, can
// be postponed for 1 day only", "in a popup reminder on each login"; 2 November: "the employees cant find the KPIs in
// the app", "in the first 3 days"): once a sign-in while scorecards wait for them (their self-rating by the 3rd, then
// their people's), as on the website (GET /api/kpis/reminder). Score now opens them; Postpone 1 day puts it off on every
// device (once a month's round, POST /api/kpis/reminder/postpone); the scorecards can be done meanwhile.

abstract final class KpiReminderWords {
  static const title = 'KPI Scoring Pending';
  static String line(int n) => n == 1 ? '1 scorecard is waiting for you.' : '$n scorecards are waiting for you.';
  static const scoreNow = 'Score now';
  static const postpone = 'Postpone 1 day';
  static const close = 'Close';
}

/// What GET /api/kpis/reminder says.
class KpiReminder {
  const KpiReminder({required this.waiting, required this.counts, required this.only, required this.postponedUntil, required this.canPostpone});

  factory KpiReminder.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiReminder(
      waiting: m['waiting'] is num ? (m['waiting'] as num).toInt() : 0,
      counts: KpiCounts.fromJson(m['counts']),
      only: m['only'] is String ? m['only'] as String : null,
      postponedUntil: m['postponedUntil'] is String ? DateTime.tryParse(m['postponedUntil'] as String) : null,
      canPostpone: m['canPostpone'] == true,
    );
  }

  final int waiting;
  final KpiCounts counts;
  final String? only;
  final DateTime? postponedUntil;
  final bool canPostpone;

  /// Something waits, and it isn't put off.
  bool showsAt(DateTime now) => waiting > 0 && !(postponedUntil != null && postponedUntil!.isAfter(now));
}

/// The sign-in it was shown in (its session token): once a sign-in.
String? _shownFor;

/// Shown once a sign-in when scorecards wait and it isn't postponed; quiet when People can't be reached.
Future<void> remindKpis(BuildContext context, WidgetRef ref) async {
  final token = await ref.read(sessionStoreProvider).read();
  if (token == null || token == _shownFor) return;
  final KpiReminder r;
  try {
    r = KpiReminder.fromJson(await ref.read(peopleClientProvider).get('/api/kpis/reminder'));
  } catch (_) {
    return;
  }
  if (!r.showsAt(DateTime.now()) || !context.mounted) return;
  _shownFor = token;
  final choice = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      icon: const Icon(Icons.insights_rounded, size: 36),
      title: const Text(KpiReminderWords.title),
      content: Text(KpiReminderWords.line(r.waiting)),
      actions: [
        if (r.canPostpone) TextButton(onPressed: () => Navigator.pop(c, 'postpone'), child: const Text(KpiReminderWords.postpone)),
        TextButton(onPressed: () => Navigator.pop(c, 'close'), child: const Text(KpiReminderWords.close)),
        FilledButton(onPressed: () => Navigator.pop(c, 'score'), child: const Text(KpiReminderWords.scoreNow)),
      ],
    ),
  );
  if (!context.mounted) return;
  if (choice == 'postpone') {
    try {
      await ref.read(peopleClientProvider).post('/api/kpis/reminder/postpone');
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  } else if (choice == 'score') {
    final only = r.only;
    if (only != null) {
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ScorecardScreen(id: only)));
    } else {
      context.go(r.counts.team > 0 ? '/dashboard/performance/team' : '/dashboard/performance');
    }
  }
}

/// For the tests: shown again in this run.
@visibleForTesting
void forgetKpiReminder() => _shownFor = null;
