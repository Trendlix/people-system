import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../format.dart';
import '../../models/attendance_month.dart';
import '../../models/holiday.dart';
import '../../models/leave.dart';
import '../../models/me.dart';
import '../../models/my_attendance.dart' show MonthRates;
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../today/today_controller.dart';
import 'dashboard_data.dart';
import '../requests/kinds/od.dart' show showOdSheet;
import 'shift_card.dart';

/// The Dashboard's words, in one place (ready for Arabic).
abstract final class DashboardWords {
  static const intro = 'Your workday, requests, and people tools in one place.';
  static const hold = 'Your access is on hold: you can still check in and out.';
  static const selfService = 'Self service';
  static const quickActions = 'Quick actions';
  static const requestLeave = 'Request leave';
  static const officialDuty = 'Official duty';
  static const awayFromOffice = 'Work away from the office';
  static const viewRequests = 'View requests';
  static const myPerformance = 'My performance';
  static const overview = 'Overview';
  static const atAGlance = 'At a glance';
  static const leaveBalance = 'Leave balance';
  static const hoursThisWeek = 'Hours this week';
  static const openRequests = 'Open requests';
  static const nextHoliday = 'Next holiday';
  static const schedule = 'Schedule';
  static const comingUp = 'Coming up';
  static const timeOff = 'Time off';
  static const daysAvailable = 'days available';
  static const requestNewLeave = 'Request new leave';
  static const attendance = 'Attendance';
  static const weeklyHours = 'Weekly hours';
  static const averageADay = 'Average a day';
  static const weeklyTarget = 'Weekly target';
  static const completeProfile = 'Complete your profile';
  static const documentsNeeded = 'Documents needed';
  static const allSet = 'Nothing to do. You’re all set.';
  static const requiredByHr = 'Required by HR';
  static const bringToHr = 'Bring them to HR, who add them to your file.';
  static const confirmDetails = 'Please review and confirm your details on the People website.';
  static const noHolidays = 'No more official holidays on file yet.';
  static const notLoaded = 'Couldn’t load this. Pull down to try again.';
  static String daysAvailableOf(String n) => '$n days available';
  static String openOf(int n) => n == 1 ? '1 open request' : '$n open requests';
  static String ofThisYear(String n) => 'of $n this year';
  static String cycleOf(String month) => '$month cycle';
  static String ofDue(int percent, String due) => '$percent% of $due';
}

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key, required this.me});

  final Me me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final today = isoDayOf(now);
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(todayProvider)
          ..invalidate(balancesProvider)
          ..invalidate(attendanceMonthProvider)
          ..invalidate(holidaysProvider)
          ..invalidate(ownProfileProvider)
          ..invalidate(openRequestsProvider)
          ..invalidate(myKpisProvider);
        await ref.read(todayProvider.future);
      },
      child: ListView(
        padding: tabPagePadding(context),
        children: [
          PageHead(eyebrow: eyebrowDateOf(now), title: '${greetingAt(now)}, ${me.firstName}', intro: DashboardWords.intro),
          if (me.hold) ...[const SizedBox(height: Tokens.gap), const Notice(text: DashboardWords.hold, ok: false)],
          const SizedBox(height: 24),
          const ShiftCard(),
          if (!me.hold && me.employeeId != null) ...[
            const SizedBox(height: 36),
            SectionHead(eyebrow: DashboardWords.selfService, title: DashboardWords.quickActions),
            const SizedBox(height: 16),
            _QuickActions(today: today),
            const SizedBox(height: 36),
            const SectionHead(eyebrow: DashboardWords.overview, title: DashboardWords.atAGlance),
            const SizedBox(height: 16),
            _Glance(today: today),
            const SizedBox(height: 16),
            _ComingUp(today: today),
            const SizedBox(height: 16),
            _LeaveCard(today: today),
            const SizedBox(height: 16),
            _WeeklyHours(today: today),
            const SizedBox(height: 16),
            const _Documents(),
          ],
        ],
      ),
    );
  }
}

// ---------- quick actions ----------

class _QuickActions extends ConsumerWidget {
  const _QuickActions({required this.today});

  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final year = int.parse(today.substring(0, 4));
    final available = ref.watch(balancesProvider(year)).value?.annual.available;
    final open = ref.watch(openRequestsProvider).value;
    final kpis = ref.watch(myKpisProvider).value;
    final latest = kpis == null || kpis.isEmpty ? null : kpis.first;
    final tiles = [
      (
        CupertinoIcons.calendar,
        DashboardWords.requestLeave,
        available == null ? null : DashboardWords.daysAvailableOf(daysFigure(available)),
        '/requests',
      ),
      // official duty in place of a correction (owner, 31 October 2026: "replace correction with OD in the homepage for the
      // requests section"): its sheet, as the Requests tab opens it
      (CupertinoIcons.briefcase, DashboardWords.officialDuty, DashboardWords.awayFromOffice, null),
      (CupertinoIcons.doc_text, DashboardWords.viewRequests, open == null ? null : DashboardWords.openOf(open), '/requests'),
      (
        CupertinoIcons.graph_square,
        DashboardWords.myPerformance,
        latest == null ? null : DashboardWords.cycleOf(monthNameOf(latest.month)),
        '/dashboard/performance',
      ),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.02,
      children: [
        for (final (icon, title, sub, path) in tiles)
          _QuickTile(icon: icon, title: title, subtitle: sub, onTap: () => path == null ? showOdSheet(context) : context.go(path)),
      ],
    );
  }
}

class _QuickTile extends StatelessWidget {
  const _QuickTile({required this.icon, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Material(
      color: p.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        side: BorderSide(color: p.line),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  IconTile(icon),
                  const Spacer(),
                  Icon(CupertinoIcons.arrow_up_right, size: 16, color: p.ink),
                ],
              ),
              const Spacer(),
              Text(title, style: text.bodyLarge),
              if (subtitle != null) Text(subtitle!, style: text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------- at a glance ----------

class _Glance extends ConsumerWidget {
  const _Glance({required this.today});

  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final year = int.parse(today.substring(0, 4));
    final annual = ref.watch(balancesProvider(year)).value?.annual;
    final week = weekOf(today);
    final months = [for (final m in monthsOf(week)) ref.watch(attendanceMonthProvider(m)).value];
    final hoursADay = months.firstWhere((m) => m != null, orElse: () => null)?.hoursADay;
    final counted = months.every((m) => m == null) ? null : _hoursOn(months, week, today).values.fold<double>(0, (a, b) => a + b);
    final working = ref.watch(ownProfileProvider).value?.workingDays.length ?? 5;
    final target = hoursADay == null ? null : hoursADay * working;
    // this week as People counts it, the attendance rate's (owner, 31 October 2026: "there is a missmatch in the work
    // percentage"): the hours worked against the hours due so far; without it (an API from before), as counted here
    final thisMonth = ref.watch(attendanceMonthProvider(today.substring(0, 7))).value;
    final rated = thisMonth == null ? null : MonthRates.of(thisMonth.raw['rates'])?.thisWeek;
    final open = ref.watch(openRequestsProvider).value;
    final holidays = ref.watch(holidaysProvider(year)).value;
    final next = holidays == null ? null : upcomingHolidays(holidays, today, limit: 1).firstOrNull;
    final tiles = [
      StatTile(
        width: 190,
        label: DashboardWords.leaveBalance,
        value: annual == null ? '—' : daysFigure(annual.available),
        unit: annual == null ? null : 'days',
        note: annual == null ? null : DashboardWords.ofThisYear(daysFigure(annual.year)),
        onTap: () => context.go('/requests'),
      ),
      StatTile(
        width: 190,
        label: DashboardWords.hoursThisWeek,
        value: rated != null ? oneDecimal(rated.workedHours) : (counted == null ? '—' : oneDecimal(counted)),
        unit: rated != null || counted != null ? 'hrs' : null,
        note: rated != null
            ? (rated.rate == null ? null : DashboardWords.ofDue((rated.rate! * 100).round(), oneDecimal(rated.dueHours)))
            : (counted == null || target == null || target == 0 ? null : '${(counted / target * 100).round()}% of ${oneDecimal(target)}'),
        onTap: () => context.go('/attendance'),
      ),
      StatTile(
        width: 190,
        label: DashboardWords.openRequests,
        value: open == null ? '—' : open.toString().padLeft(2, '0'),
        note: open == null ? null : (open == 0 ? 'none waiting' : 'being decided'),
        onTap: () => context.go('/requests'),
      ),
      StatTile(
        width: 190,
        label: DashboardWords.nextHoliday,
        value: next == null ? '—' : (next.inDays == 0 ? 'Today' : '${next.inDays}'),
        unit: next == null || next.inDays == 0 ? null : (next.inDays == 1 ? 'day' : 'days'),
        note: next?.nameEn,
      ),
    ];
    return SizedBox(
      height: 150,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        itemCount: tiles.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (_, i) => tiles[i],
      ),
    );
  }
}

Map<String, double> _hoursOn(List<AttendanceMonth?> months, List<String> dates, String upTo) {
  final wanted = {
    for (final d in dates)
      if (d.compareTo(upTo) <= 0) d,
  };
  final out = <String, double>{};
  for (final m in months) {
    if (m == null) continue;
    for (final day in m.days) {
      if (wanted.contains(day.date)) out[day.date] = (out[day.date] ?? 0) + day.hoursCounted;
    }
  }
  return out;
}

// ---------- coming up: the official holidays as the design's schedule ----------

class _ComingUp extends ConsumerWidget {
  const _ComingUp({required this.today});

  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final year = int.parse(today.substring(0, 4));
    final years = [year, if (int.parse(today.substring(5, 7)) >= 10) year + 1];
    final lists = [for (final y in years) ref.watch(holidaysProvider(y))];
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    Widget body;
    if (lists.first.hasError) {
      body = Text(DashboardWords.notLoaded, style: text.bodyMedium?.copyWith(color: p.muted));
    } else if (lists.any((l) => l.isLoading)) {
      body = const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    } else {
      final next = upcomingHolidays([for (final l in lists) ...?l.value], today, limit: 4);
      body = next.isEmpty
          ? Text(DashboardWords.noHolidays, style: text.bodyMedium?.copyWith(color: p.muted))
          : Column(
              children: [
                for (final (i, h) in next.indexed)
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(width: 56, child: Text(shortDateOf(h.from).replaceFirst(RegExp(r' \d{4}$'), ''), style: text.bodySmall)),
                        SizedBox(
                          width: 22,
                          child: Column(
                            children: [
                              Container(
                                margin: const EdgeInsets.only(top: 3),
                                width: 12,
                                height: 12,
                                padding: const EdgeInsets.all(2),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(color: p.ink),
                                ),
                                child: Container(
                                  decoration: BoxDecoration(shape: BoxShape.circle, color: p.ink),
                                ),
                              ),
                              Expanded(child: Container(width: 1, color: i == next.length - 1 ? Colors.transparent : p.line)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${inDaysText(h.inDays)}${h.days > 1 ? ' · ${h.days} days' : ''}', style: text.bodySmall),
                                Text(h.nameEn, style: text.bodyLarge),
                                if (h.nameAr != null) Text(h.nameAr!, textDirection: TextDirection.rtl, style: text.bodySmall),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            );
    }
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const CardHead(eyebrow: DashboardWords.schedule, title: DashboardWords.comingUp),
          const SizedBox(height: 18),
          body,
        ],
      ),
    );
  }
}

// ---------- leave balance ----------

class _LeaveCard extends ConsumerWidget {
  const _LeaveCard({required this.today});

  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final balances = ref.watch(balancesProvider(int.parse(today.substring(0, 4))));
    final a = balances.value?.annual;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(
            eyebrow: DashboardWords.timeOff,
            title: DashboardWords.leaveBalance,
            trailing: IconButton(
              tooltip: DashboardWords.leaveBalance,
              onPressed: () => context.go('/requests'),
              style: IconButton.styleFrom(side: BorderSide(color: p.line)),
              icon: Icon(CupertinoIcons.arrow_up_right, size: 16, color: p.ink),
            ),
          ),
          const SizedBox(height: 18),
          if (a == null)
            Text(balances.hasError ? DashboardWords.notLoaded : '…', style: text.bodyMedium?.copyWith(color: p.muted))
          else ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(daysFigure(a.available), style: text.displayMedium),
                const SizedBox(width: 12),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text('days\navailable', style: text.bodySmall),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _AnnualBar(a: a),
          ],
          const SizedBox(height: 20),
          OutlinedButton(onPressed: () => context.go('/requests'), child: const Text(DashboardWords.requestNewLeave)),
        ],
      ),
    );
  }
}

class _AnnualBar extends StatelessWidget {
  const _AnnualBar({required this.a});

  final AnnualBalance a;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final used = a.taken + a.booked;
    final total = [a.year, a.available + used + a.pending, 1.0].reduce((x, y) => x > y ? x : y);
    int flex(double v) => (v / total * 1000).round().clamp(0, 1000);
    Widget seg(Color c, double v) => v <= 0
        ? const SizedBox.shrink()
        : Expanded(
            flex: flex(v),
            child: Container(
              height: 6,
              decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)),
            ),
          );
    final rest = total - a.available - used;
    Widget legend(Color c, String label, double v) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(shape: BoxShape.circle, color: c),
        ),
        const SizedBox(width: 6),
        Text(label, style: text.bodySmall),
        const SizedBox(width: 6),
        Text(daysFigure(v), style: text.labelMedium),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            seg(p.ink, a.available),
            const SizedBox(width: 4),
            seg(p.muted, used),
            const SizedBox(width: 4),
            seg(p.track, rest > 0 ? rest : 0),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [legend(p.ink, 'Entitlement', a.year), legend(p.muted, 'Taken', used), legend(p.line, 'Pending', a.pending)],
        ),
      ],
    );
  }
}

// ---------- weekly hours ----------

class _WeeklyHours extends ConsumerWidget {
  const _WeeklyHours({required this.today});

  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final week = weekOf(today);
    final last = weekOf(today, back: 1);
    final months = [
      for (final m in monthsOf([...last, ...week])) ref.watch(attendanceMonthProvider(m)).value,
    ];
    if (months.every((m) => m == null)) return const SizedBox.shrink();
    final hoursADay = months.firstWhere((m) => m != null, orElse: () => null)?.hoursADay;
    final working = (ref.watch(ownProfileProvider).value?.workingDays ?? const [0, 1, 2, 3, 4]).toSet();
    final shown = [
      for (final d in week)
        if (working.contains(weekdayOf(d))) d,
    ];
    final counted = _hoursOn(months, week, today);
    final thisWeek = counted.values.fold<double>(0, (a, b) => a + b);
    final idx = week.indexOf(today);
    final lastWeek = _hoursOn(months, last, last[idx < 0 ? 6 : idx]).values.fold<double>(0, (a, b) => a + b);
    final change = weeklyChange(thisWeek, lastWeek);
    final worked = counted.values.where((h) => h > 0).toList();
    final average = worked.isEmpty ? null : worked.reduce((a, b) => a + b) / worked.length;
    final top = [hoursADay ?? 8, ...shown.map((d) => counted[d] ?? 0)].reduce((a, b) => a > b ? a : b) * 1.1;
    final marked = shown.where((d) => d.compareTo(today) <= 0).lastOrNull;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(
            eyebrow: DashboardWords.attendance,
            title: DashboardWords.weeklyHours,
            trailing: change == null ? null : Pill('${change >= 0 ? '↗' : '↘'} ${change.abs()}%'),
          ),
          const SizedBox(height: 18),
          SizedBox(
            height: 150,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                for (final d in shown)
                  Semantics(
                    label: '${shortWeekday(d)}: ${d.compareTo(today) > 0 ? 'still to come' : hoursAndMinutesOf(counted[d] ?? 0)}',
                    excludeSemantics: true,
                    child: Container(
                      width: 26,
                      height: d.compareTo(today) > 0 ? 0 : (150 * ((counted[d] ?? 0) / top)).clamp(6, 150).toDouble(),
                      decoration: BoxDecoration(
                        color: d == marked ? p.ink : p.track,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(10)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Container(height: 1, color: p.line),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (final d in shown)
                SizedBox(
                  width: 34,
                  child: Text(
                    shortWeekday(d),
                    textAlign: TextAlign.center,
                    style: text.bodySmall?.copyWith(color: d == marked ? p.ink : p.muted),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(DashboardWords.averageADay, style: text.bodySmall),
                  Text(average == null ? '—' : hoursAndMinutesOf(average), style: text.bodyLarge),
                ],
              ),
              const SizedBox(width: 40),
              if (hoursADay != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(DashboardWords.weeklyTarget, style: text.bodySmall),
                    Text('${oneDecimal(hoursADay * shown.length)} hours', style: text.bodyLarge),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------- documents needed ----------

class _Documents extends ConsumerWidget {
  const _Documents();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final profile = ref.watch(ownProfileProvider).value;
    if (profile == null) return const SizedBox.shrink();
    final papers = profile.papersMissing;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(
            eyebrow: DashboardWords.completeProfile,
            title: papers.isEmpty ? 'To do' : DashboardWords.documentsNeeded,
            trailing: Text('${profile.percent}%', style: text.titleLarge?.copyWith(fontWeight: FontWeight.w400)),
          ),
          const SizedBox(height: 16),
          if (papers.isEmpty && !profile.needsConfirming) Text(DashboardWords.allSet, style: text.bodyMedium),
          if (profile.needsConfirming) ...[Text(DashboardWords.confirmDetails, style: text.bodyMedium), const SizedBox(height: 12)],
          for (final paper in papers)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: p.raised,
                borderRadius: BorderRadius.circular(Tokens.radiusTile),
                border: Border.all(color: p.line),
              ),
              child: Row(
                children: [
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: p.line),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(paper, style: text.bodyLarge),
                        Text(DashboardWords.requiredByHr, style: text.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (papers.isNotEmpty) Text(DashboardWords.bringToHr, style: text.bodySmall),
        ],
      ),
    );
  }
}
