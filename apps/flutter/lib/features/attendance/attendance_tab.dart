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
import '../../theme/wide.dart';
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

  /// On an iPad with room for two panes (owner, 8 November 2026: "i think the Ipad needs a better layout with some more
  /// features available due to the larger screen"): the day picked, shown beside the calendar instead of in a sheet;
  /// null: today, else the month's latest day on record.
  String? _day;

  /// Whether the tab shows the two panes now (as last built).
  var _beside = false;

  void _openDay(MyMonth m, String date, String today) {
    if (_beside) {
      setState(() => _day = date);
      return;
    }
    showDaySheet(
      context,
      month: m,
      date: date,
      today: today,
      onAsk: () => _ask(m, today, date: date),
      onMyCorrections: _myCorrections,
    );
  }

  /// The day the pane beside the calendar shows: the one picked, else today, else the month's latest day so far (or its
  /// first); null with nothing on record.
  String? _shownDay(MyMonth? m, String today) {
    if (m == null || m.days.isEmpty) return null;
    if (_day != null && m.dayOn(_day!) != null) return _day;
    if (m.dayOn(today) != null) return today;
    final past = [for (final d in m.days) if (d.date.compareTo(today) <= 0) d.date]..sort();
    return past.lastOrNull ?? m.days.first.date;
  }

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
    // the page's own width beside the rail or the sidebar (app_shell.dart tells it)
    final width = MediaQuery.sizeOf(context).width;
    _beside = withMonth && roomForTwo(context, width);
    final read = _beside ? ref.watch(myMonthProvider(_month)) : null;
    final month = read?.value;
    final shown = _beside ? _shownDay(month, today) : null;
    Future<void> refresh() async {
      ref
        ..invalidate(todayProvider)
        ..invalidate(attendanceMonthProvider(_month));
      await Future.wait([ref.read(todayProvider.future), if (withMonth) ref.read(myMonthProvider(_month).future)]).catchError((_) => const <Object>[]);
    }

    final page = RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: _beside ? panePadding(context) : tabPagePadding(context),
        children: [
          const PageHead(eyebrow: AttendanceWords.eyebrow, title: AttendanceWords.title),
          if (withMonth) ...[
            const SizedBox(height: 20),
            _MonthSwitch(
              month: _month,
              onChanged: (m) => setState(() {
                _month = m;
                _day = null;
              }),
            ),
          ],
          const SizedBox(height: 24),
          // on an iPad, Today sits beside the month, over the day picked
          if (!_beside) const TodayPanel(),
          if (me != null && me.hold) ...[const SizedBox(height: 12), const Notice(text: AttendanceWords.hold, ok: false)],
          if (me != null && !me.hold && me.employeeId == null) ...[const SizedBox(height: 12), Notice(text: AttendanceWords.noProfile(me.email), ok: false)],
          if (withMonth) ...[
            if (!_beside) const SizedBox(height: 12),
            _Month(month: _month, today: today, onOpenDay: _openDay, onAsk: _ask, onMyCorrections: _myCorrections, selected: shown),
          ],
        ],
      ),
    );
    if (!_beside) return page;
    // on an iPad: the month on the left (the calendar in sight at once); Today and the day picked on the right
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: page),
        VerticalDivider(width: 1, thickness: 1, color: context.palette.line),
        SizedBox(
          width: listPaneWidth(width),
          child: RefreshIndicator(
            onRefresh: refresh,
            child: _DayPane(
              month: month,
              loading: month == null && read?.hasError != true,
              date: shown,
              today: today,
              onAsk: () => _ask(month!, today, date: shown),
              onMyCorrections: _myCorrections,
            ),
          ),
        ),
      ],
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
  const _Month({required this.month, required this.today, required this.onOpenDay, required this.onAsk, required this.onMyCorrections, this.selected});

  final String month;
  final String today;
  final void Function(MyMonth m, String date, String today) onOpenDay;
  final Future<void> Function(MyMonth m, String today, {String? date}) onAsk;
  final VoidCallback onMyCorrections;

  /// The day shown beside the calendar on an iPad (8 November 2026), marked in it and in Your days.
  final String? selected;

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
        CalendarCard(month: month, data: m, today: today, selected: selected, onOpenDay: (date) => onOpenDay(m!, date, today)),
        if (m != null) ...[
          // the attendance rate through the month (owner, 31 October 2026), above the month's figures
          if (m.rates case final r? when m.days.isNotEmpty) ...[const SizedBox(height: 12), RateCard(rates: r)],
          if (m.days.isNotEmpty) ...[const SizedBox(height: 12), FiguresGrid(month: m)],
          const SizedBox(height: 14),
          YourDaysCard(
            month: m,
            today: today,
            selected: selected,
            onOpenDay: (date) => onOpenDay(m, date, today),
            onMyCorrections: onMyCorrections,
            onAsk: () => onAsk(m, today),
          ),
        ],
      ],
    );
  }
}

/// On an iPad, beside the month (8 November 2026), scrolling on its own: Today with the one button, then the day picked
/// as the phone's sheet shows it (DayDetails) in a card; a word to pick one while the month has nothing on record.
class _DayPane extends StatelessWidget {
  const _DayPane({required this.month, required this.loading, required this.date, required this.today, required this.onAsk, required this.onMyCorrections});

  final MyMonth? month;

  /// The month still being read: a wait, not the word to pick a day.
  final bool loading;
  final String? date;
  final String today;
  final VoidCallback onAsk;
  final VoidCallback onMyCorrections;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final m = month;
    final d = date;
    return ListView(
      padding: panePadding(context),
      children: [
        const TodayPanel(),
        const SizedBox(height: 12),
        SurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Eyebrow(AttendanceWords.yourDay),
              const SizedBox(height: 8),
              if (loading)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (m == null || d == null) ...[
                Text(AttendanceWords.noDayTitle, style: text.headlineSmall),
                const SizedBox(height: 8),
                Text(AttendanceWords.pickADay, style: text.bodyMedium?.copyWith(color: context.palette.muted)),
              ] else ...[
                Semantics(liveRegion: true, child: Text(AttendanceWords.dayTitle(d), style: text.headlineSmall)),
                const SizedBox(height: 12),
                DayDetails(month: m, date: d, today: today, onAsk: onAsk, onMyCorrections: onMyCorrections),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
