import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';

import '../../format.dart';
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';

/// The attendance calendar (the phone design, 30 October 2026): the month, Week or Month, a week at a time with its
/// number and days ("Week 5 · 25–31 October"), each day a cell with a dot by what it was (worked, rest, leave, holiday,
/// and absent, leave in Zoho only, no check-in when there are any), today ringed, and the legend. From the month's own
/// days, nothing else; a day on record opens its details.
class CalendarCard extends StatefulWidget {
  const CalendarCard({super.key, required this.month, required this.data, required this.today, required this.onOpenDay});

  /// YYYY-MM.
  final String month;

  /// The month's days; null while they load.
  final MyMonth? data;

  /// YYYY-MM-DD.
  final String today;
  final ValueChanged<String> onOpenDay;

  @override
  State<CalendarCard> createState() => _CalendarCardState();
}

class _CalendarCardState extends State<CalendarCard> {
  var _wholeMonth = false;
  late int _week = _firstWeek();

  /// This month: the week of today; another: its first.
  int _firstWeek() => widget.today.startsWith(widget.month) ? weekIndexOf(widget.month, widget.today) : 0;

  @override
  void didUpdateWidget(CalendarCard old) {
    super.didUpdateWidget(old);
    if (old.month != widget.month) _week = _firstWeek();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final weeks = weeksOf(widget.month);
    final week = _week.clamp(0, weeks.length - 1);
    final data = widget.data;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Eyebrow(AttendanceWords.calendar),
          const SizedBox(height: 5),
          Text(monthNameOf(widget.month), style: text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.77)),
          const SizedBox(height: 16),
          _ViewSwitch(wholeMonth: _wholeMonth, onChanged: (v) => setState(() => _wholeMonth = v)),
          if (!_wholeMonth) ...[
            const SizedBox(height: 20),
            _WeekNav(
              number: week + 1,
              span: weekSpanOf(widget.month, weeks[week]),
              onBack: week > 0 ? () => setState(() => _week = week - 1) : null,
              onNext: week < weeks.length - 1 ? () => setState(() => _week = week + 1) : null,
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              for (final w in AttendanceWords.weekdayColumns)
                Expanded(
                  child: ExcludeSemantics(child: Text(w, textAlign: TextAlign.center, style: text.bodySmall)),
                ),
            ],
          ),
          const SizedBox(height: 7),
          if (data == null)
            const SizedBox(height: 58, child: Center(child: CircularProgressIndicator()))
          else
            for (final (i, w) in (_wholeMonth ? weeks : [weeks[week]]).indexed) ...[
              if (i > 0) const SizedBox(height: 6),
              Row(
                children: [
                  for (final date in w)
                    Expanded(
                      child: date.startsWith(widget.month)
                          ? _DayCell(
                              date: date,
                              day: data.dayOn(date),
                              today: date == widget.today,
                              onTap: data.dayOn(date) == null ? null : () => widget.onOpenDay(date),
                            )
                          : const SizedBox(height: 58),
                    ),
                ],
              ),
            ],
          const SizedBox(height: 20),
          Wrap(
            spacing: 18,
            runSpacing: 8,
            children: [for (final l in legendOf(data ?? MyMonth(month: widget.month))) _LegendItem(look: l)],
          ),
        ],
      ),
    );
  }
}

/// Week · Month, the chosen one filled (the design's 50-high switch with its corners of 11 and 8).
class _ViewSwitch extends StatelessWidget {
  const _ViewSwitch({required this.wholeMonth, required this.onChanged});

  final bool wholeMonth;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    Widget item(bool month, String label) {
      final on = month == wholeMonth;
      return Expanded(
        child: Semantics(
          button: true,
          selected: on,
          child: Material(
            color: on ? p.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              onTap: () => onChanged(month),
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                height: 42,
                child: Center(child: Text(label, style: text.labelMedium?.copyWith(color: on ? p.onPrimary : p.muted))),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(11), border: Border.all(color: p.line)),
      child: Row(children: [item(false, AttendanceWords.week), const SizedBox(width: 3), item(true, AttendanceWords.month)]),
    );
  }
}

/// ← Week 5 / 25–31 October →: the arrows quiet at the month's first and last week.
class _WeekNav extends StatelessWidget {
  const _WeekNav({required this.number, required this.span, required this.onBack, required this.onNext});

  final int number;
  final String span;
  final VoidCallback? onBack;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        _Arrow(icon: CupertinoIcons.arrow_left, tooltip: AttendanceWords.previousWeek, onTap: onBack),
        Expanded(
          child: Semantics(
            liveRegion: true,
            child: Column(
              children: [
                Text(AttendanceWords.weekNumber(number), style: text.bodyMedium?.copyWith(height: 1.5)),
                const SizedBox(height: 3),
                Text(span, style: text.bodySmall),
              ],
            ),
          ),
        ),
        _Arrow(icon: CupertinoIcons.arrow_right, tooltip: AttendanceWords.nextWeek, onTap: onNext),
      ],
    );
  }
}

class _Arrow extends StatelessWidget {
  const _Arrow({required this.icon, required this.tooltip, required this.onTap});

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final on = onTap != null;
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        enabled: on,
        label: tooltip,
        excludeSemantics: true,
        child: Material(
          color: Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11), side: BorderSide(color: on ? p.line : p.line.withValues(alpha: 0.5))),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(11),
            child: SizedBox.square(
              dimension: Tokens.tapTarget,
              child: Icon(icon, size: 18, color: on ? p.ink : p.line),
            ),
          ),
        ),
      ),
    );
  }
}

/// A day: its number and a dot by what it was; today ringed. Days with nothing on record dashed.
class _DayCell extends StatelessWidget {
  const _DayCell({required this.date, required this.day, required this.today, required this.onTap});

  final String date;
  final DayRecord? day;
  final bool today;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final look = lookOf(day);
    final (Color? fill, Color edge, double width, Color number) = switch (look) {
      DayLook.worked => (p.primary, p.primary, 1.0, p.onPrimary),
      DayLook.leave => (p.raised, p.ink, 2.0, p.ink),
      DayLook.rest => (p.raised, p.line, 1.0, p.ink),
      DayLook.zohoLeave => (p.raised, p.line, 1.0, p.ink),
      DayLook.absent => (null, p.danger, 1.0, p.danger),
      DayLook.holiday || DayLook.noCheckIn => (null, p.line, 1.0, p.ink),
      DayLook.none => (null, p.line, 1.0, p.muted),
    };
    final radius = BorderRadius.circular(10);
    Widget cell = Container(
      height: 58,
      decoration: BoxDecoration(
        color: fill,
        borderRadius: radius,
        border: look == DayLook.none ? null : Border.all(color: edge, width: width),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('${int.parse(date.substring(8))}', style: text.bodyLarge?.copyWith(color: number, height: 1.5)),
          const SizedBox(height: 8),
          _Dot(look: look, small: true),
        ],
      ),
    );
    if (look == DayLook.none) cell = CustomPaint(foregroundPainter: _Dashed(color: p.line, radius: 10), child: cell);
    if (today) {
      // the ring just outside the cell, the cell keeping its size
      cell = Stack(
        clipBehavior: Clip.none,
        fit: StackFit.passthrough,
        children: [
          cell,
          Positioned(
            left: -2,
            top: -2,
            right: -2,
            bottom: -2,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: p.ink, width: 2)),
              ),
            ),
          ),
        ],
      );
    }
    final what = day == null ? AttendanceWords.nothingOnRecord : AttendanceWords.statusOf(day!.status);
    return Semantics(
      button: onTap != null,
      label: AttendanceWords.cellLabel(AttendanceWords.dayLong(date), what, today: today),
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: cell),
      ),
    );
  }
}

/// A day's dot (6 across in a cell) or the legend's mark (10 across): filled, a ring, or an outlined square.
class _Dot extends StatelessWidget {
  const _Dot({required this.look, this.small = false});

  final DayLook look;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final size = small ? 6.0 : 10.0;
    final square = BorderRadius.circular(small ? 3 : 2);
    final (Color? fill, Color? ring, bool round) = switch (look) {
      DayLook.worked => (small ? p.onPrimary : p.primary, null, small),
      DayLook.rest => (small ? p.line : p.track, null, small),
      DayLook.leave => (null, p.ink, true),
      DayLook.holiday => (small ? p.muted : null, small ? null : p.line, small),
      DayLook.absent => (p.danger, null, small),
      DayLook.zohoLeave => (null, p.muted, true),
      DayLook.noCheckIn => (null, p.muted, false),
      DayLook.none => (p.muted, null, true),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: fill,
        shape: round ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: round ? null : square,
        border: ring == null ? null : Border.all(color: ring),
      ),
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.look});

  final DayLook look;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Dot(look: look),
        const SizedBox(width: 7),
        Text(AttendanceWords.legend[legendKey(look)] ?? '', style: text.bodySmall),
      ],
    );
  }
}

/// A dashed outline (the design's day with nothing on record yet).
class _Dashed extends CustomPainter {
  const _Dashed({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final path = Path()..addRRect(RRect.fromRectAndRadius((Offset.zero & size).deflate(0.5), Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += 4) {
        canvas.drawPath(metric.extractPath(d, d + 2.5), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_Dashed old) => old.color != color || old.radius != radius;
}
