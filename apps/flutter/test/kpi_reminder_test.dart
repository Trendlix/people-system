import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/kpis/kpi_reminder.dart';

// KPI Scoring Pending in the app (owner, 2 November 2026: "the employees cant find the KPIs in the app", "in the first
// 3 days").

void main() {
  test('shows while scorecards wait and it isn’t postponed', () {
    final now = DateTime.utc(2026, 11, 2, 9);
    KpiReminder of(Map<String, Object?> json) => KpiReminder.fromJson(json);
    expect(of({'waiting': 1, 'counts': {'self': 1, 'team': 0, 'hr': 0}, 'only': 'k1', 'canPostpone': true}).showsAt(now), isTrue);
    expect(of({'waiting': 0}).showsAt(now), isFalse);
    expect(of({'waiting': 2, 'postponedUntil': '2026-11-03T08:00:00Z'}).showsAt(now), isFalse);
    expect(of({'waiting': 2, 'postponedUntil': '2026-11-02T08:00:00Z'}).showsAt(now), isTrue);
    final r = of({'waiting': 3, 'counts': {'self': 1, 'team': 2, 'hr': 0}, 'only': null, 'canPostpone': false});
    expect([r.counts.team, r.only, r.canPostpone], [2, null, false]);
    expect(KpiReminderWords.line(1), '1 scorecard is waiting for you.');
    expect(KpiReminderWords.line(3), '3 scorecards are waiting for you.');
  });
}
