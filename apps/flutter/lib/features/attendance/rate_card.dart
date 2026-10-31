import 'package:flutter/material.dart';

import '../../format.dart' show monthNameOf;
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_words.dart';

/// The attendance rate through the month (owner, 31 October 2026: "show the weekly attendance percentage and monthly
/// percentage ongoing through the month"), People's: the hours worked against the hours due, as "Hours this week" and the
/// payroll measure it ("there is a missmatch in the work percentage"): the month so far large, this week beside it, and
/// every week of the month begun as a chip, each in the owner's colours (under 80% red, 80 to 90 yellow, over 90 green).
class RateCard extends StatelessWidget {
  const RateCard({super.key, required this.rates});

  final MonthRates rates;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final month = rates.monthToDate;
    final week = rates.thisWeek;
    final weeks = rates.weeks.where((w) => w.dueHours > 0 || w.current).toList();
    Color? colour(double? rate) => switch (rateBandOf(rate)) {
      final b? => p.bandColour(b),
      null => null,
    };
    final figure = text.headlineMedium?.copyWith(height: 1.2, fontFeatures: const [FontFeature.tabularFigures()]);
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(AttendanceWords.attendanceRate),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: MergeSemantics(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(week != null ? AttendanceWords.thisMonth : monthNameOfRate(month), style: text.bodySmall),
                      Text(AttendanceWords.percent(month.rate), style: figure?.copyWith(color: colour(month.rate))),
                      Text(AttendanceWords.hoursOf(month.workedHours, month.dueHours, soFar: week != null), style: text.bodySmall),
                    ],
                  ),
                ),
              ),
              if (week != null)
                Expanded(
                  child: MergeSemantics(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(AttendanceWords.thisWeek, style: text.bodySmall),
                        Text(AttendanceWords.percent(week.rate), style: figure?.copyWith(color: colour(week.rate))),
                        Text(AttendanceWords.weekRange(week.from, week.to), style: text.bodySmall),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          if (weeks.length > 1) ...[
            const SizedBox(height: 14),
            Text(AttendanceWords.weekByWeek, style: text.bodySmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final w in weeks)
                  _WeekChip(
                    range: AttendanceWords.weekRange(w.from, w.to),
                    percent: AttendanceWords.percent(w.rate),
                    colour: colour(w.rate),
                    current: w.current,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// "October 2026" for a month gone by (the card's label then).
String monthNameOfRate(RatePart month) => monthNameOf(month.from.substring(0, 7));

class _WeekChip extends StatelessWidget {
  const _WeekChip({required this.range, required this.percent, required this.colour, required this.current});

  final String range;
  final String percent;
  final Color? colour;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      label: '${current ? '${AttendanceWords.thisWeek}, ' : ''}$range: $percent',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: p.raised,
          borderRadius: BorderRadius.circular(Tokens.radiusPill),
          border: Border.all(color: current ? p.ink : p.line),
        ),
        child: Text.rich(
          TextSpan(
            children: [
              TextSpan(text: '$range  ', style: text.bodySmall),
              TextSpan(
                text: percent,
                style: text.labelMedium?.copyWith(color: colour ?? p.ink, fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
