// The employee's own KPI scorecards (GET /api/kpis/scorecards/mine, packages/shared kpis.ts `KpiScorecardSummary`):
// the month, its step and, once signed off, its final % and level.

const kpiLevelLabels = {
  'unacceptable': 'Unacceptable',
  'unsatisfactory': 'Unsatisfactory',
  'needs_improvement': 'Needs improvement',
  'meets': 'Meets expectations',
  'above': 'Above expectations',
};

const kpiStatusLabels = {'self_rating': 'Self-rating', 'manager': 'With the manager', 'hr': 'With HR', 'sign_off': 'Sign-off', 'final': 'Final'};

class KpiScorecard {
  const KpiScorecard({
    required this.id,
    required this.month,
    required this.status,
    required this.finalPercent,
    required this.level,
    required this.deadline,
  });

  factory KpiScorecard.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiScorecard(
      id: '${m['id'] ?? ''}',
      month: '${m['month'] ?? ''}',
      status: '${m['status'] ?? ''}',
      finalPercent: m['finalPercent'] is num ? (m['finalPercent'] as num).toDouble() : null,
      level: m['level'] is String ? m['level'] as String : null,
      deadline: m['deadline'] is String ? m['deadline'] as String : null,
    );
  }

  final String id;

  /// YYYY-MM.
  final String month;
  final String status;
  final double? finalPercent;
  final String? level;
  final String? deadline;

  String get statusLabel => kpiStatusLabels[status] ?? status;
  String? get levelLabel => level == null ? null : kpiLevelLabels[level] ?? level;
}

List<KpiScorecard> kpiScorecardsOf(Object? json) => json is List ? json.map(KpiScorecard.fromJson).toList() : const [];
