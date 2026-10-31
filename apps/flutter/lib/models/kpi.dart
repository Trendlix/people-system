// KPI scorecards (owner, 21 October 2026: "Self, manager, HR, sign-off"; packages/shared kpis.ts, the API's answers):
// a scorecard in a list (GET /api/kpis/scorecards/mine, …/waiting, …?scope=team: `KpiScorecardSummary`), the month, its
// step and, once signed off, its final % and level; and one scorecard in full (GET /api/kpis/scorecards/:id:
// `KpiScorecardView`), its pillars and metrics with the picks the caller may see, the score, the comments, every step,
// the deadlines and what the caller may do now. The score of picks as they are made is the shared rule (kpiScore),
// written again here so the app works it out live as the website does. Read by hand; anything missing reads as nothing.

const kpiLevelLabels = {
  'unacceptable': 'Unacceptable',
  'unsatisfactory': 'Unsatisfactory',
  'needs_improvement': 'Needs improvement',
  'meets': 'Meets expectations',
  'above': 'Above expectations',
};

const kpiStatusLabels = {'self_rating': 'Self-rating', 'manager': 'With the manager', 'hr': 'With HR', 'sign_off': 'Sign-off', 'final': 'Final'};

/// The most a final % can be (KPI_FINAL_CAP).
const kpiFinalCap = 110.0;

/// The longest comment on a pick, a step or a sign-off (KPI_COMMENT_MAX).
const kpiCommentMax = 1000;

/// A person as the KPI pages name them.
class KpiPerson {
  const KpiPerson({required this.id, required this.employeeCode, required this.fullNameEn});

  static KpiPerson? fromJson(Object? json) {
    if (json is! Map) return null;
    return KpiPerson(id: '${json['id'] ?? ''}', employeeCode: '${json['employeeCode'] ?? ''}', fullNameEn: '${json['fullNameEn'] ?? ''}');
  }

  final String id;
  final String employeeCode;
  final String fullNameEn;
}

/// A scorecard in a list (`KpiScorecardSummary`).
class KpiScorecard {
  const KpiScorecard({
    required this.id,
    required this.month,
    required this.status,
    required this.finalPercent,
    required this.level,
    required this.deadline,
    this.employee,
    this.jobTitle,
    this.department,
    this.templateVersion = 0,
    this.scorerKind = 'manager',
    this.scorerName,
    this.selfMissed = false,
    this.calibrated = 0,
    this.signedEmployee = false,
    this.signedManager = false,
    this.unsigned = false,
    this.action,
    this.confidential = false,
    this.practice = false,
  });

  factory KpiScorecard.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    final scorer = m['scorer'] is Map ? m['scorer'] as Map : const {};
    final signed = m['signed'] is Map ? m['signed'] as Map : const {};
    return KpiScorecard(
      id: '${m['id'] ?? ''}',
      month: '${m['month'] ?? ''}',
      status: '${m['status'] ?? ''}',
      finalPercent: m['finalPercent'] is num ? (m['finalPercent'] as num).toDouble() : null,
      level: m['level'] is String ? m['level'] as String : null,
      deadline: m['deadline'] is String ? m['deadline'] as String : null,
      employee: KpiPerson.fromJson(m['employee']),
      jobTitle: _text(m['jobTitle']),
      department: _text(m['department']),
      templateVersion: m['templateVersion'] is num ? (m['templateVersion'] as num).toInt() : 0,
      scorerKind: scorer['kind'] is String ? scorer['kind'] as String : 'manager',
      scorerName: _text(scorer['name']),
      selfMissed: m['selfMissed'] == true,
      calibrated: m['calibrated'] is num ? (m['calibrated'] as num).toInt() : 0,
      signedEmployee: signed['employee'] == true,
      signedManager: signed['manager'] == true,
      unsigned: m['unsigned'] == true,
      action: m['action'] is String ? m['action'] as String : null,
      confidential: m['confidential'] == true,
      practice: m['practice'] is Map,
    );
  }

  final String id;

  /// YYYY-MM.
  final String month;
  final String status;
  final double? finalPercent;
  final String? level;
  final String? deadline;

  /// Whose it is (always sent by People; null only for an answer the app couldn't read).
  final KpiPerson? employee;
  final String? jobTitle;

  /// "Web Development", or a team as "Web Development › Frontend".
  final String? department;
  final int templateVersion;

  /// Who scores it: manager, hr, ceo, super_admin (KPI_SCORERS), and their name when People knows it.
  final String scorerKind;
  final String? scorerName;
  final bool selfMissed;

  /// How many picks HR changed.
  final int calibrated;
  final bool signedEmployee;
  final bool signedManager;

  /// Final without every signature (by the sign-off day).
  final bool unsigned;

  /// What the caller may do on it now (self_rate, score, calibrate, sign); null: nothing.
  final String? action;

  /// A C-level person's.
  final bool confidential;

  /// A practice scorecard (never counted).
  final bool practice;

  String get statusLabel => kpiStatusLabels[status] ?? status;
  String? get levelLabel => level == null ? null : kpiLevelLabels[level] ?? level;
}

List<KpiScorecard> kpiScorecardsOf(Object? json) => json is List ? json.map(KpiScorecard.fromJson).toList() : const [];

/// What waits for the caller (GET /api/kpis/counts): their own, their people's, HR's.
class KpiCounts {
  const KpiCounts({required this.self, required this.team, required this.hr});

  factory KpiCounts.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    int n(Object? v) => v is num ? v.toInt() : 0;
    return KpiCounts(self: n(m['self']), team: n(m['team']), hr: n(m['hr']));
  }

  final int self;
  final int team;
  final int hr;
}

/// The days of the next month each step is due by (GET /api/kpis/settings).
class KpiSettings {
  const KpiSettings({required this.selfRatingDay, required this.managerDay, required this.hrDay, required this.signOffDay});

  static KpiSettings? fromJson(Object? json) {
    if (json is! Map) return null;
    int? n(Object? v) => v is num ? v.toInt() : null;
    final s = n(json['selfRatingDay']), m = n(json['managerDay']), h = n(json['hrDay']), o = n(json['signOffDay']);
    if (s == null || m == null || h == null || o == null) return null;
    return KpiSettings(selfRatingDay: s, managerDay: m, hrDay: h, signOffDay: o);
  }

  final int selfRatingDay;
  final int managerDay;
  final int hrDay;
  final int signOffDay;
}

// ---------- one scorecard ----------

/// One step of a metric's criteria scale: what it says and the points it gives.
class KpiCriterion {
  const KpiCriterion({required this.label, required this.points});

  final String label;
  final double points;
}

/// A pick at a step: the criterion's index (null: not picked) and its comment.
class KpiPick {
  const KpiPick({required this.choice, required this.comment});

  static KpiPick? fromJson(Object? json) {
    if (json is! Map) return null;
    final c = json['choice'];
    return KpiPick(choice: c is num ? c.toInt() : null, comment: _text(json['comment']));
  }

  final int? choice;
  final String? comment;
}

/// A metric on a scorecard, with the picks the caller may see (null: hidden from them, or not picked yet).
class KpiMetric {
  const KpiMetric({
    required this.id,
    required this.pillar,
    required this.name,
    required this.definition,
    required this.howMeasured,
    required this.duties,
    required this.targetPoints,
    required this.criteria,
    required this.self,
    required this.manager,
    required this.hr,
    required this.points,
  });

  factory KpiMetric.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    final criteria = m['criteria'] is List
        ? [
            for (final c in m['criteria'] as List)
              if (c is Map) KpiCriterion(label: '${c['label'] ?? ''}', points: c['points'] is num ? (c['points'] as num).toDouble() : 0),
          ]
        : const <KpiCriterion>[];
    return KpiMetric(
      id: '${m['id'] ?? ''}',
      pillar: m['pillar'] is String ? m['pillar'] as String : null,
      name: '${m['name'] ?? ''}',
      definition: _text(m['definition']),
      howMeasured: _text(m['howMeasured']),
      duties: _dutiesOf(m),
      targetPoints: m['targetPoints'] is num ? (m['targetPoints'] as num).toDouble() : 0,
      criteria: criteria,
      self: KpiPick.fromJson(m['self']),
      manager: KpiPick.fromJson(m['manager']),
      hr: KpiPick.fromJson(m['hr']),
      points: m['points'] is num ? (m['points'] as num).toDouble() : null,
    );
  }

  final String id;
  final String? pillar;
  final String name;
  final String? definition;
  final String? howMeasured;

  /// The JD duties it measures (kpiMetricDuties: the list, else the one duty of before).
  final List<String> duties;
  final double targetPoints;
  final List<KpiCriterion> criteria;
  final KpiPick? self;
  final KpiPick? manager;

  /// HR's change of the manager's pick, with its reason as the comment.
  final KpiPick? hr;

  /// The points of the pick that counts as the caller sees it; null: none.
  final double? points;
}

/// A pillar on a scorecard: its weight, metrics and score as the caller sees it.
class KpiPillar {
  const KpiPillar({
    required this.key,
    required this.name,
    required this.short,
    required this.weight,
    required this.metrics,
    required this.achieved,
    required this.max,
    required this.percent,
    required this.leftOut,
  });

  factory KpiPillar.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    double n(Object? v) => v is num ? v.toDouble() : 0;
    return KpiPillar(
      key: '${m['key'] ?? ''}',
      name: '${m['name'] ?? ''}',
      short: '${m['short'] ?? m['name'] ?? ''}',
      weight: n(m['weight']),
      metrics: m['metrics'] is List ? (m['metrics'] as List).map(KpiMetric.fromJson).toList() : const [],
      achieved: n(m['achieved']),
      max: n(m['max']),
      percent: n(m['percent']),
      leftOut: m['leftOut'] == true,
    );
  }

  final String key;
  final String name;
  final String short;

  /// In whole percent.
  final double weight;
  final List<KpiMetric> metrics;
  final double achieved;
  final double max;
  final double percent;

  /// Not scored: attendance is out of the KPI and nothing else is in it.
  final bool leftOut;
}

/// One pillar's score (`KpiPillarScore`).
class KpiPillarScore {
  const KpiPillarScore({
    required this.key,
    required this.name,
    required this.short,
    required this.weight,
    required this.achieved,
    required this.max,
    required this.percent,
    required this.complete,
    this.leftOut = false,
  });

  factory KpiPillarScore.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    double n(Object? v) => v is num ? v.toDouble() : 0;
    return KpiPillarScore(
      key: '${m['key'] ?? ''}',
      name: '${m['name'] ?? ''}',
      short: '${m['short'] ?? m['name'] ?? ''}',
      weight: n(m['weight']),
      achieved: n(m['achieved']),
      max: n(m['max']),
      percent: n(m['percent']),
      complete: m['complete'] == true,
      leftOut: m['leftOut'] == true,
    );
  }

  final String key;
  final String name;
  final String short;
  final double weight;
  final double achieved;
  final double max;
  final double percent;
  final bool complete;
  final bool leftOut;
}

/// A scorecard's score: its pillars, the final % (capped at 110, to one decimal) and its level.
class KpiScoreResult {
  const KpiScoreResult({required this.pillars, required this.finalPercent, required this.level, required this.complete, required this.capped});

  static KpiScoreResult? fromJson(Object? json) {
    if (json is! Map || json['finalPercent'] is! num) return null;
    return KpiScoreResult(
      pillars: json['pillars'] is List ? (json['pillars'] as List).map(KpiPillarScore.fromJson).toList() : const [],
      finalPercent: (json['finalPercent'] as num).toDouble(),
      level: json['level'] is String ? json['level'] as String : kpiLevelOf((json['finalPercent'] as num).toDouble()),
      complete: json['complete'] == true,
      capped: json['capped'] == true,
    );
  }

  final List<KpiPillarScore> pillars;
  final double finalPercent;
  final String level;
  final bool complete;
  final bool capped;

  String get levelLabel => kpiLevelLabels[level] ?? level;
}

/// The automatic Attendance metric on a scorecard.
class KpiAttendance {
  const KpiAttendance({required this.points, required this.achieved, required this.ratio, required this.score, required this.source, required this.counted});

  factory KpiAttendance.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    double? n(Object? v) => v is num ? v.toDouble() : null;
    return KpiAttendance(
      points: n(m['points']) ?? 0,
      achieved: n(m['achieved']) ?? 0,
      ratio: n(m['ratio']),
      score: n(m['score']),
      source: m['source'] is String ? m['source'] as String : 'none',
      // missing from an API before 25 October 2026: it counted
      counted: m['counted'] != false,
    );
  }

  final double points;
  final double achieved;

  /// Worked ÷ expected hours as payroll counts them; null when attendance isn't counted for the month.
  final double? ratio;
  final double? score;

  /// payroll, attendance or none.
  final String source;

  /// Whether it counts in the score (owner, 25 October 2026: "Fixed cut only").
  final bool counted;
}

/// A step logged on a scorecard: what, when, by whom, with its comment.
class KpiStep {
  const KpiStep({required this.kind, required this.label, required this.at, required this.by, required this.comment});

  factory KpiStep.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiStep(kind: '${m['kind'] ?? ''}', label: '${m['label'] ?? m['kind'] ?? ''}', at: '${m['at'] ?? ''}', by: _text(m['by']), comment: _text(m['comment']));
  }

  final String kind;
  final String label;

  /// ISO moment.
  final String at;
  final String? by;
  final String? comment;
}

/// A month's scorecard's deadlines (YYYY-MM-DD, days of the next month).
class KpiDeadlines {
  const KpiDeadlines({required this.selfRating, required this.manager, required this.hr, required this.signOff});

  factory KpiDeadlines.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiDeadlines(selfRating: '${m['selfRating'] ?? ''}', manager: '${m['manager'] ?? ''}', hr: '${m['hr'] ?? ''}', signOff: '${m['signOff'] ?? ''}');
  }

  final String selfRating;
  final String manager;
  final String hr;
  final String signOff;
}

/// What the caller may do on a scorecard now (the API decides; it checks again on every step).
class KpiCan {
  const KpiCan({this.selfRate = false, this.score = false, this.calibrate = false, this.signAsEmployee = false, this.signAsManager = false});

  factory KpiCan.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiCan(
      selfRate: m['selfRate'] == true,
      score: m['score'] == true,
      calibrate: m['calibrate'] == true,
      signAsEmployee: m['signAsEmployee'] == true,
      signAsManager: m['signAsManager'] == true,
    );
  }

  final bool selfRate;
  final bool score;
  final bool calibrate;
  final bool signAsEmployee;
  final bool signAsManager;
}

/// The comments on the whole month, by step, as the caller may see them.
class KpiComments {
  const KpiComments({this.self, this.manager, this.hr, this.employeeSign, this.managerSign});

  factory KpiComments.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return KpiComments(
      self: _text(m['self']),
      manager: _text(m['manager']),
      hr: _text(m['hr']),
      employeeSign: _text(m['employeeSign']),
      managerSign: _text(m['managerSign']),
    );
  }

  final String? self;
  final String? manager;
  final String? hr;
  final String? employeeSign;
  final String? managerSign;
}

/// One scorecard in full (GET /api/kpis/scorecards/:id, and every step's answer).
class KpiScorecardView {
  const KpiScorecardView({
    required this.card,
    required this.pillars,
    required this.attendancePillar,
    required this.attendance,
    required this.score,
    required this.selfScore,
    required this.comments,
    required this.steps,
    required this.deadlines,
    required this.can,
    required this.payrollMonth,
  });

  factory KpiScorecardView.fromJson(Object? json) {
    if (json is! Map || json['id'] is! String) throw const FormatException('KPI scorecard: not one');
    return KpiScorecardView(
      card: KpiScorecard.fromJson(json),
      pillars: json['pillars'] is List ? (json['pillars'] as List).map(KpiPillar.fromJson).toList() : const [],
      attendancePillar: '${json['attendancePillar'] ?? ''}',
      attendance: KpiAttendance.fromJson(json['attendance']),
      score: KpiScoreResult.fromJson(json['score']),
      selfScore: KpiScoreResult.fromJson(json['selfScore']),
      comments: KpiComments.fromJson(json['comments']),
      steps: json['steps'] is List ? (json['steps'] as List).map(KpiStep.fromJson).toList() : const [],
      deadlines: KpiDeadlines.fromJson(json['deadlines']),
      can: KpiCan.fromJson(json['can']),
      payrollMonth: '${json['payrollMonth'] ?? ''}',
    );
  }

  /// What a list shows of it: whose, the month, the step, the score, what waits for the caller.
  final KpiScorecard card;

  /// Its template version's pillars, as it was published: the scorecard is scored with them.
  final List<KpiPillar> pillars;

  /// The key of the pillar the Attendance metric counts in.
  final String attendancePillar;
  final KpiAttendance attendance;

  /// The score as the caller sees it (the manager's picks, calibrated); null when hidden from them or not scored.
  final KpiScoreResult? score;

  /// The employee's self-rating's own score, for those who see it.
  final KpiScoreResult? selfScore;
  final KpiComments comments;
  final List<KpiStep> steps;
  final KpiDeadlines deadlines;
  final KpiCan can;

  /// The payroll it counts in, YYYY-MM.
  final String payrollMonth;

  /// Every metric the caller may pick, in the order of the pillars (never the Attendance metric: the system's).
  List<KpiMetric> get metrics => [for (final p in pillars) ...p.metrics];
}

// ---------- the score (packages/shared kpis.ts) ----------

double _round1(double n) => (n * 10 + 1e-9).roundToDouble() / 10;

/// The level of a final % (owner, 21 October 2026: "Unacceptable < 50 · Unsatisfactory 50–70 · Needs improvement 70–90 ·
/// Meets expectations 90–100 · Above expectations 100–110").
String kpiLevelOf(double percent) {
  if (percent > 100) return 'above';
  if (percent >= 90) return 'meets';
  if (percent >= 70) return 'needs_improvement';
  if (percent >= 50) return 'unsatisfactory';
  return 'unacceptable';
}

/// A percent as the screens write it: whole when it is ("86%"), else to one decimal ("89.6%").
String kpiPercentText(double percent) {
  final r = _round1(percent);
  return r == r.roundToDouble() ? '${r.toInt()}%' : '${r.toStringAsFixed(1)}%';
}

/// The score of the metrics with the criteria picked (`choices` by metric id; missing or null: not picked) and the
/// Attendance metric's points achieved (null: it doesn't count), in the scorecard's own pillars. Pillar % = achieved ÷
/// max; final % = Σ pillar % × its weight, at most 110; the Attendance metric's pillar with nothing of its own while
/// attendance doesn't count is left out, its weight spread over the others in proportion (kpiScore).
KpiScoreResult kpiScore(
  List<KpiMetric> metrics,
  Map<String, int?> choices,
  ({double points, double achieved})? attendance,
  List<KpiPillar> pillars,
  String attendancePillar,
) {
  final scored = [
    for (final p in pillars)
      () {
        var achieved = 0.0, max = 0.0;
        var complete = true;
        for (final m in metrics) {
          if (m.pillar != p.key) continue;
          max += m.targetPoints;
          final choice = choices[m.id];
          if (choice != null && choice >= 0 && choice < m.criteria.length) {
            achieved += m.criteria[choice].points;
          } else {
            complete = false;
          }
        }
        if (attendance != null && p.key == attendancePillar) {
          max += attendance.points;
          achieved += attendance.achieved;
        }
        return (p: p, achieved: achieved, max: max, complete: complete, leftOut: attendance == null && p.key == attendancePillar && max == 0);
      }(),
  ];
  final all = scored.fold<double>(0, (sum, s) => sum + s.p.weight);
  final kept = scored.fold<double>(0, (sum, s) => sum + (s.leftOut ? 0 : s.p.weight));
  final spread = kept != all;
  var total = 0.0;
  final out = [
    for (final s in scored)
      () {
        final fraction = s.max > 0 ? s.achieved / s.max : 0.0;
        if (!s.leftOut) total += spread ? (kept > 0 ? fraction * s.p.weight * all / kept : 0) : fraction * s.p.weight;
        return KpiPillarScore(
          key: s.p.key,
          name: s.p.name,
          short: s.p.short,
          weight: s.p.weight,
          achieved: s.achieved,
          max: s.max,
          percent: _round1(fraction * 100),
          complete: s.complete,
          leftOut: s.leftOut,
        );
      }(),
  ];
  final finalPercent = _round1(total > kpiFinalCap ? kpiFinalCap : total);
  return KpiScoreResult(pillars: out, finalPercent: finalPercent, level: kpiLevelOf(finalPercent), complete: out.every((p) => p.complete), capped: total > kpiFinalCap);
}

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;

/// A metric's JD duties: its list (or one as text), else the one duty it had before, each once (kpiMetricDuties).
List<String> _dutiesOf(Map m) {
  final sent = m['jdDuties'] is String ? [m['jdDuties']] : (m['jdDuties'] is List ? m['jdDuties'] as List : const []);
  var duties = _tidy(sent.whereType<String>());
  if (duties.isEmpty && m['jdDuty'] is String) duties = _tidy([m['jdDuty'] as String]);
  return duties;
}

List<String> _tidy(Iterable<String> duties) {
  final seen = <String>{};
  return [
    for (final d in duties.map((d) => d.trim()).where((d) => d.isNotEmpty))
      if (seen.add(d.toLowerCase().replaceAll(RegExp(r'\s+'), ' '))) d,
  ];
}
