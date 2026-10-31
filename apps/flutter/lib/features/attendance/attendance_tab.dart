import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/my_attendance.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import '../today/today_controller.dart';
import 'attendance_data.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';
import 'calendar_card.dart';
import 'correction_sheet.dart';
import 'day_sheet.dart';
import 'figures_grid.dart';
import 'rate_card.dart';
import 'my_corrections_screen.dart';
import 'today_panel.dart';
import 'your_days.dart';

/// The Attendance tab (the phone design, 30 October 2026; the website's My Attendance): the month with the one before
/// and after a tap away, Today with the one button, the attendance calendar by week or month, the month's figures, and
/// "Your days", each day opening its details; My corrections and Ask for a correction. The employee's own, as People
/// answers them; everything People decides (the payroll's lock, the checks of a correction) it checks again.
class AttendanceTab extends ConsumerStatefulWidget {
  const AttendanceTab({super.key});

  @override
  ConsumerState<AttendanceTab> createState() => _AttendanceTabState();
}

class _AttendanceTabState extends ConsumerState<AttendanceTab> {
  late String _month = isoDayOf(ref.read(attendanceClockProvider)()).substring(0, 7);

  void _openDay(MyMonth m, String date, String today) => showDaySheet(
    context,
    month: m,
    date: date,
    today: today,
    onAsk: () => _ask(m, today, date: date),
    onMyCorrections: _myCorrections,
  );

  void _myCorrections() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const MyCorrectionsScreen()));

  Future<void> _ask(MyMonth m, String today, {String? date}) async {
    final messenger = ScaffoldMessenger.of(context);
    final made = await showCorrectionSheet(context, month: m, today: today, date: date);
    if (made == null) return;
    messenger.showSnackBar(SnackBar(content: Text(AttendanceWords.sent(made.status, managerRole: made.managerRole, confidential: made.confidential))));
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    final today = isoDayOf(ref.watch(attendanceClockProvider)());
    final withMonth = me != null && !me.hold && me.employeeId != null;
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(todayProvider)
          ..invalidate(attendanceMonthProvider(_month));
        await Future.wait([ref.read(todayProvider.future), if (withMonth) ref.read(myMonthProvider(_month).future)]).catchError((_) => const <Object>[]);
      },
      child: ListView(
        padding: tabPagePadding(context),
        children: [
          const PageHead(eyebrow: AttendanceWords.eyebrow, title: AttendanceWords.title, intro: AttendanceWords.intro),
          if (withMonth) ...[const SizedBox(height: 20), _MonthSwitch(month: _month, onChanged: (m) => setState(() => _month = m))],
          const SizedBox(height: 24),
          const TodayPanel(),
          if (me != null && me.hold) ...[const SizedBox(height: 12), const Notice(text: AttendanceWords.hold, ok: false)],
          if (me != null && !me.hold && me.employeeId == null) ...[const SizedBox(height: 12), Notice(text: AttendanceWords.noProfile(me.email), ok: false)],
          if (withMonth) ...[const SizedBox(height: 12), _Month(month: _month, today: today, onOpenDay: _openDay, onAsk: _ask, onMyCorrections: _myCorrections)],
        ],
      ),
    );
  }
}

/// ← October 2026 →, in the design's pill.
class _MonthSwitch extends StatelessWidget {
  const _MonthSwitch({required this.month, required this.onChanged});

  final String month;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final before = addMonths(month, -1);
    final after = addMonths(month, 1);
    Widget step(IconData icon, String to) => IconButton(
      tooltip: AttendanceWords.showMonth(monthNameOf(to)),
      onPressed: () => onChanged(to),
      icon: Icon(icon, size: 20, color: p.ink),
    );
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(Tokens.radiusPill), border: Border.all(color: p.line)),
      child: Row(
        children: [
          step(CupertinoIcons.arrow_left, before),
          Expanded(
            child: Semantics(
              liveRegion: true,
              child: Text(monthNameOf(month), textAlign: TextAlign.center, style: text.bodyLarge?.copyWith(height: 1.5)),
            ),
          ),
          step(CupertinoIcons.arrow_right, after),
        ],
      ),
    );
  }
}

/// The month: its exemptions, the calendar, the figures and Your days.
class _Month extends ConsumerWidget {
  const _Month({required this.month, required this.today, required this.onOpenDay, required this.onAsk, required this.onMyCorrections});

  final String month;
  final String today;
  final void Function(MyMonth m, String date, String today) onOpenDay;
  final Future<void> Function(MyMonth m, String today, {String? date}) onAsk;
  final VoidCallback onMyCorrections;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final loaded = ref.watch(myMonthProvider(month));
    final m = loaded.value;
    if (loaded.hasError && m == null) {
      final e = loaded.error;
      return Notice(
        text: e is ApiException ? e.message : AttendanceWords.monthFailed,
        ok: false,
        action: AttendanceWords.tryAgain,
        onAction: () => ref.invalidate(attendanceMonthProvider(month)),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // exempt from check-in (25 October 2026): the month's periods, said once at its top
        if (m != null && m.exemptions.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(label: AttendanceWords.exemptionLabel, excludeSemantics: true, child: const Pill(AttendanceWords.exempt)),
                const SizedBox(width: 10),
                Expanded(child: Text(AttendanceWords.exemptions(m.exemptions), style: text.bodyMedium?.copyWith(color: p.muted))),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        CalendarCard(month: month, data: m, today: today, onOpenDay: (date) => onOpenDay(m!, date, today)),
        if (m != null) ...[
          // the attendance rate through the month (owner, 31 October 2026), above the month's figures
          if (m.rates case final r? when m.days.isNotEmpty) ...[const SizedBox(height: 12), RateCard(rates: r)],
          if (m.days.isNotEmpty) ...[const SizedBox(height: 12), FiguresGrid(month: m)],
          const SizedBox(height: 14),
          YourDaysCard(
            month: m,
            today: today,
            onOpenDay: (date) => onOpenDay(m, date, today),
            onMyCorrections: onMyCorrections,
            onAsk: () => onAsk(m, today),
          ),
        ],
      ],
    );
  }
}
