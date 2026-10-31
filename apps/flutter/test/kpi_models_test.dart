import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/kpis/kpi_words.dart';
import 'package:people/models/kpi.dart';
import 'package:people/models/me.dart';

// The KPI scorecards as People sends them (packages/shared kpis.ts), the score worked out live as the shared rule does
// (kpiScore), and the website's words for where a scorecard stands and what waits (apps/web kpis/scorecard.ts).

/// A criteria scale: 10, 30 or 40 points, the target 40.
List<Map<String, Object?>> scale() => [
  {'label': 'Often late', 'points': 10},
  {'label': 'Mostly on time', 'points': 30},
  {'label': 'Always on time', 'points': 40},
];

Map<String, Object?> metricJson(
  String id,
  String pillar,
  String name, {
  Map<String, Object?>? self,
  Map<String, Object?>? manager,
  Map<String, Object?>? hr,
  num? points,
}) => {
  'id': id,
  'pillar': pillar,
  'name': name,
  'definition': 'How $name went this month.',
  'howMeasured': 'From the project tracker.',
  'jdDuties': ['Ship designs on time', 'ship designs on time', ' '],
  'targetPoints': 40,
  'criteria': scale(),
  'self': self,
  'manager': manager,
  'hr': hr,
  'points': points,
};

/// A scorecard in a list (KpiScorecardSummary).
Map<String, Object?> cardJson({
  String id = 'k1',
  String month = '2026-10',
  String status = 'self_rating',
  String? action = 'self_rate',
  String? deadline = '2026-11-03',
  String employeeId = 'e1',
  String name = 'Mohamed Abdelrahman',
  String scorer = 'manager',
  String? scorerName = 'Sara Ali',
  num? finalPercent,
  String? level,
  bool signedEmployee = false,
  bool signedManager = false,
  bool selfMissed = false,
}) => {
  'id': id,
  'month': month,
  'employee': {'id': employeeId, 'employeeCode': 'EMP-0007', 'fullNameEn': name},
  'jobTitle': 'Designer',
  'department': 'Creative',
  'departmentId': 'd1',
  'status': status,
  'templateVersion': 2,
  'scorer': {'kind': scorer, 'name': scorerName},
  'finalPercent': finalPercent,
  'level': level,
  'selfMissed': selfMissed,
  'calibrated': 0,
  'signed': {'employee': signedEmployee, 'manager': signedManager},
  'unsigned': false,
  'action': action,
  'deadline': deadline,
  'confidential': false,
};

/// One scorecard in full (KpiScorecardView): two pillars of 50%, a metric each, the Attendance metric (20 of 20) in
/// Discipline & Growth.
Map<String, Object?> viewJson({
  String id = 'k1',
  String status = 'self_rating',
  String? action = 'self_rate',
  String employeeId = 'e1',
  String name = 'Mohamed Abdelrahman',
  Map<String, Object?> can = const {'selfRate': true},
  Map<String, Object?>? m1Self,
  Map<String, Object?>? m2Self,
  Map<String, Object?>? m1Manager,
  Map<String, Object?>? m2Manager,
  Map<String, Object?>? score,
  Map<String, Object?>? selfScore,
  Map<String, Object?> comments = const {},
  String selfRatingDeadline = '2026-11-03',
  bool attendanceCounted = true,
  num? finalPercent,
  String? level,
  bool signedEmployee = false,
}) => {
  ...cardJson(id: id, status: status, action: action, employeeId: employeeId, name: name, finalPercent: finalPercent, level: level, signedEmployee: signedEmployee),
  'template': {'id': 't1', 'version': 2, 'jobTitleId': 'j1'},
  'pillars': [
    {
      'key': 'delivery',
      'name': 'Delivery & Timeliness',
      'short': 'Delivery',
      'weight': 50,
      'metrics': [metricJson('m1', 'delivery', 'On-time delivery', self: m1Self, manager: m1Manager)],
      'achieved': 0,
      'max': 40,
      'percent': 0,
      'complete': false,
    },
    {
      'key': 'discipline',
      'name': 'Discipline & Growth',
      'short': 'Discipline',
      'weight': 50,
      'metrics': [metricJson('m2', 'discipline', 'Learning', self: m2Self, manager: m2Manager)],
      'achieved': 20,
      'max': 60,
      'percent': 33.3,
      'complete': false,
    },
  ],
  'attendancePillar': 'discipline',
  'attendance': {'points': 20, 'achieved': 20, 'ratio': 0.98, 'score': 1, 'source': 'attendance', 'counted': attendanceCounted},
  'score': score,
  'selfScore': selfScore,
  'comments': comments,
  'steps': [
    {'kind': 'opened', 'label': 'Opened', 'at': '2026-11-01T06:00:00.000Z', 'by': null, 'comment': null},
  ],
  'deadlines': {'selfRating': selfRatingDeadline, 'manager': '2026-11-06', 'hr': '2026-11-08', 'signOff': '2026-11-10'},
  'can': can,
  'payrollMonth': '2026-11',
};

void main() {
  test('reads a scorecard in a list, with whose it is, who scores it and what waits', () {
    final k = KpiScorecard.fromJson(cardJson(status: 'manager', action: 'score', deadline: '2026-11-06'));
    expect((k.id, k.month, k.status, k.statusLabel, k.action, k.deadline), ('k1', '2026-10', 'manager', 'With the manager', 'score', '2026-11-06'));
    expect((k.employee!.fullNameEn, k.jobTitle, k.department, k.templateVersion), ('Mohamed Abdelrahman', 'Designer', 'Creative', 2));
    expect((k.scorerKind, k.scorerName, k.signedEmployee, k.practice), ('manager', 'Sara Ali', false, false));
    // the fields of before still read as they did
    final old = KpiScorecard.fromJson({'id': 'k0', 'month': '2026-09', 'status': 'final', 'finalPercent': 95, 'level': 'meets', 'deadline': null});
    expect((old.finalPercent, old.levelLabel, old.employee, old.scorerKind, old.action), (95.0, 'Meets expectations', null, 'manager', null));
    expect(kpiScorecardsOf('nope'), isEmpty);
  });

  test('reads one scorecard in full: its pillars, metrics and picks, the attendance, deadlines and what the caller may do', () {
    final v = KpiScorecardView.fromJson(viewJson(m1Self: {'choice': 2, 'comment': 'Shipped every brief'}, can: const {'selfRate': true, 'signAsEmployee': false}));
    expect(v.pillars.map((p) => (p.key, p.weight, p.metrics.length)), [('delivery', 50.0, 1), ('discipline', 50.0, 1)]);
    expect(v.metrics.map((m) => m.id), ['m1', 'm2']);
    final m1 = v.metrics.first;
    expect((m1.self!.choice, m1.self!.comment, m1.manager, m1.targetPoints, m1.criteria.length), (2, 'Shipped every brief', null, 40.0, 3));
    // the duties each once, blanks left out
    expect(m1.duties, ['Ship designs on time']);
    expect((v.attendancePillar, v.attendance.points, v.attendance.counted, v.attendance.source), ('discipline', 20.0, true, 'attendance'));
    expect((v.deadlines.selfRating, v.deadlines.signOff, v.payrollMonth), ('2026-11-03', '2026-11-10', '2026-11'));
    expect((v.can.selfRate, v.can.score, v.can.signAsEmployee), (true, false, false));
    expect((v.score, v.selfScore, v.steps.single.label), (null, null, 'Opened'));
    expect(() => KpiScorecardView.fromJson({'no': 'id'}), throwsFormatException);
    // an API from before attendance could be left out: it counted
    expect(KpiAttendance.fromJson({'points': 20, 'achieved': 18}).counted, isTrue);
  });

  group('the score as it is picked (shared kpiScore)', () {
    final v = KpiScorecardView.fromJson(viewJson());
    final withAttendance = (points: 20.0, achieved: 20.0);

    test('each pillar its points of its targets, the Attendance metric in its pillar; the final % by the weights', () {
      final s = kpiScore(v.metrics, {'m1': 2, 'm2': 1}, withAttendance, v.pillars, v.attendancePillar);
      expect(s.pillars.map((p) => (p.key, p.achieved, p.max, p.percent, p.complete)), [('delivery', 40.0, 40.0, 100.0, true), ('discipline', 50.0, 60.0, 83.3, true)]);
      expect((s.finalPercent, s.level, s.complete, s.capped), (91.7, 'meets', true, false));
      expect(kpiPercentText(s.finalPercent), '91.7%');
    });

    test('a metric not picked counts 0 until it is', () {
      final s = kpiScore(v.metrics, {'m1': 0}, withAttendance, v.pillars, v.attendancePillar);
      expect(s.pillars.map((p) => (p.achieved, p.complete)), [(10.0, true), (20.0, false)]);
      expect((s.finalPercent, s.level, s.complete), (29.2, 'unacceptable', false));
    });

    test('attendance out of the KPI: its pillar alone with nothing is left out, its weight spread over the others', () {
      final pillars = [
        KpiPillar(key: 'delivery', name: 'Delivery', short: 'Delivery', weight: 70, metrics: [v.metrics.first], achieved: 0, max: 40, percent: 0, leftOut: false),
        const KpiPillar(key: 'discipline', name: 'Discipline', short: 'Discipline', weight: 30, metrics: [], achieved: 0, max: 0, percent: 0, leftOut: true),
      ];
      final s = kpiScore([v.metrics.first], {'m1': 1}, null, pillars, 'discipline');
      expect(s.pillars.map((p) => p.leftOut), [false, true]);
      expect((s.finalPercent, s.level), (75.0, 'needs_improvement'));
    });

    test('capped at 110%', () {
      final rich = KpiMetric.fromJson({
        'id': 'x',
        'pillar': 'delivery',
        'name': 'Beyond',
        'targetPoints': 10,
        'criteria': [
          {'label': 'Way beyond', 'points': 30},
        ],
      });
      final pillars = [KpiPillar(key: 'delivery', name: 'Delivery', short: 'Delivery', weight: 100, metrics: [rich], achieved: 0, max: 10, percent: 0, leftOut: false)];
      final s = kpiScore([rich], {'x': 0}, null, pillars, 'other');
      expect((s.finalPercent, s.capped, s.level), (110.0, true, 'above'));
    });

    test('the levels at their edges', () {
      expect(<double>[49.9, 50, 70, 90, 100, 100.1].map(kpiLevelOf),['unacceptable', 'unsatisfactory', 'needs_improvement', 'meets', 'meets', 'above']);
      expect([86.0, 89.6, 104.55].map(kpiPercentText), ['86%', '89.6%', '104.6%']);
    });
  });

  group('the website’s words', () {
    test('where it stands, by who scores it', () {
      expect(statusText('manager', 'manager'), 'With the manager');
      expect(statusText('manager', 'hr'), 'With HR');
      expect(statusText('manager', 'ceo'), 'With the CEO');
      expect(statusText('sign_off', 'manager'), 'Sign-off');
      expect(scorerText('manager', 'Sara Ali'), 'Sara Ali (manager)');
      expect(scorerText('hr', null), 'HR: nobody is in charge of this person');
    });

    test('what waits, and by when', () {
      final rate = KpiScorecard.fromJson(cardJson());
      expect((actionText(rate), actionButton(rate), ownCardText(rate)), ('Rate yourself by 03/11/2026', 'Rate yourself', 'Your October 2026 KPI: rate yourself by 03/11/2026'));
      final early = KpiScorecard.fromJson(cardJson(action: 'score'));
      expect(actionText(early), 'Self-rating due 03/11/2026, then score');
      final sign = KpiScorecard.fromJson(cardJson(status: 'sign_off', action: 'sign', deadline: '2026-11-10'));
      expect((ownCardText(sign), waitingLine(sign)), ('Your October 2026 KPI: ready to sign by 10/11/2026', 'October 2026 · Sign by 10/11/2026'));
      final none = KpiScorecard.fromJson(cardJson(status: 'final', action: null, deadline: null));
      expect((actionText(none), actionButton(none)), (null, 'Open'));
    });

    test('the step’s deadline, the payroll, the attendance and the pick in words', () {
      final v = KpiScorecardView.fromJson(viewJson());
      expect(stepDeadlineText('manager', v.deadlines), 'Scoring by 06/11/2026');
      expect(stepDeadlineText('sign_off', v.deadlines), 'Sign-off by 10/11/2026; final then even if not signed');
      expect(stepDeadlineText('final', v.deadlines), isNull);
      expect(payrollText(v.payrollMonth), 'Counts in the November 2026 payroll');
      expect(attendanceText(v.attendance).detail, 'Worked 98% of the expected hours, attendance score 100%.');
      expect(attendanceText(KpiAttendance.fromJson({'source': 'none'})), (source: 'Not counted: full points', detail: "Attendance isn't counted for this month, so it counts as full."));
      expect((pickText(v.metrics.first, 2), pickText(v.metrics.first, null), targetIndex(v.metrics.first)), ('Always on time · 40 pts', null, 2));
      expect((pointsText(1), pointsText(2.5)), ('1 pt', '2.5 pts'));
    });

    test('what a page says once a step is done', () {
      final v = KpiScorecardView.fromJson(viewJson(status: 'manager', action: null));
      expect(doneText('self_sent', v).text, 'Your self-rating is sent. Your manager scores the month next; you see the score at the sign-off.');
      expect(doneText('self_saved', v).text, 'Your self-rating is saved, not sent yet. Send it by 03/11/2026.');
      expect(doneText('score_saved', v).text, 'Your scoring is saved, not sent yet. Send it by 06/11/2026.');
      final hr = KpiScorecardView.fromJson(viewJson(status: 'hr', action: null));
      expect(doneText('score_sent', hr).text, 'Your scoring is sent to HR to calibrate.');
      expect(doneText('signed', hr).text, 'Signed. It is final once both have signed, or after 10/11/2026 anyway.');
      expect(doneText('moved', hr).ok, isFalse);
    });

    test('dates as the website shows them; the months and days of the review', () {
      expect((kpiDate('2026-11-03'), kpiMessage('Due by 2026-11-03, then 2026-11-06.')), ('03/11/2026', 'Due by 03/11/2026, then 06/11/2026.'));
      expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinalDay), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
      expect((scorecardMonthOn('2026-11-02'), scorecardMonthOn('2027-01-15')), ('2026-10', '2026-12'));
      final steps = reviewSteps(const KpiSettings(selfRatingDay: 3, managerDay: 6, hrDay: 8, signOffDay: 10));
      expect(steps.map((s) => (s.title, s.due)), [('Self-rating', 'By the 3rd'), ('Manager’s scoring', 'By the 6th'), ('HR calibration', 'By the 8th'), ('Sign-off', 'By the 10th')]);
      expect(reviewSteps(null).every((s) => s.due == null), isTrue);
      expect(KpiSettings.fromJson({'selfRatingDay': 3}), isNull);
    });
  });

  test('who scores a team’s scorecards: a manager, someone in charge of a department or team, the CEO', () {
    Me me(List<String> roles, {bool leads = false}) => Me.fromJson({'id': 'u1', 'email': 'a@example.test', 'roles': roles, 'employeeId': 'e1', 'leads': leads});
    expect(me(['employee']).scoresTeam, isFalse);
    expect(me(['employee', 'manager']).scoresTeam, isTrue);
    expect(me(['employee'], leads: true).scoresTeam, isTrue);
    expect(me(['ceo']).scoresTeam, isTrue);
    expect(me(['hr']).scoresTeam, isFalse);
  });
}
