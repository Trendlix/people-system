import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/kpi.dart';
import '../../providers.dart';
import '../dashboard/dashboard_data.dart' show myKpisProvider;

// What the KPI screens read from People (apps/api kpis.controller.ts): the scorecards waiting for the caller, what waits
// as counts, the review's deadlines, the scorecards of the people they score by month (and the months there are), one
// scorecard in full; and the steps they take on one: the employee's self-rating, the scorer's scoring (each saved or
// sent) and the sign-off. The API decides who may do what; the screens only offer what it says the caller may.

abstract final class KpiPaths {
  static const mine = '/api/kpis/scorecards/mine';
  static const waiting = '/api/kpis/scorecards/waiting';
  static const counts = '/api/kpis/counts';
  static const settings = '/api/kpis/settings';
  static String team(String month) => '/api/kpis/scorecards?scope=team&month=$month';
  static const teamMonths = '/api/kpis/heatmap?scope=team&months=6';
  static String one(String id) => '/api/kpis/scorecards/$id';
  static String self(String id) => '/api/kpis/scorecards/$id/self';
  static String score(String id) => '/api/kpis/scorecards/$id/score';
  static String sign(String id) => '/api/kpis/scorecards/$id/sign';
}

/// The scorecards waiting for the caller (their own and those they score), the nearest deadline first.
final kpiWaitingProvider = FutureProvider.autoDispose<List<KpiScorecard>>(
  (ref) async => kpiScorecardsOf(await ref.read(peopleClientProvider).get(KpiPaths.waiting)),
);

/// What waits for the caller, as counts: their own, their people's, HR's.
final kpiCountsProvider = FutureProvider.autoDispose<KpiCounts>((ref) async => KpiCounts.fromJson(await ref.read(peopleClientProvider).get(KpiPaths.counts)));

/// The days each step is due by; null when they couldn't be read (the steps are shown without them).
final kpiSettingsProvider = FutureProvider.autoDispose<KpiSettings?>((ref) async {
  try {
    return KpiSettings.fromJson(await ref.read(peopleClientProvider).get(KpiPaths.settings));
  } on Exception {
    return null;
  }
});

/// The months the team's overview has (the last six, oldest first); none when it couldn't be read.
final teamMonthsProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  try {
    final json = await ref.read(peopleClientProvider).get(KpiPaths.teamMonths);
    final months = json is Map && json['months'] is List ? (json['months'] as List).whereType<String>().toList() : <String>[];
    return months;
  } on Exception {
    return const [];
  }
});

/// A month's scorecards of the people the caller scores, newest month first, then by name.
final teamScorecardsProvider = FutureProvider.autoDispose.family<List<KpiScorecard>, String>(
  (ref, month) async => kpiScorecardsOf(await ref.read(peopleClientProvider).get(KpiPaths.team(month))),
);

/// After a step: the lists and counts read again.
void kpisChanged(WidgetRef ref) {
  ref
    ..invalidate(myKpisProvider)
    ..invalidate(kpiWaitingProvider)
    ..invalidate(kpiCountsProvider)
    ..invalidate(teamScorecardsProvider);
}
