import 'package:flutter/material.dart';

import '../../format.dart';
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';

/// "Your days" (the phone design, 30 October 2026; the website's My Attendance table): My corrections and Ask for a
/// correction (while the month's payroll isn't approved, else why not), every day kept, each its day and date, what it
/// was (worked and leave as badges; working from home, official duty, exempt, a correction under it) and its hours with
/// its balance; a day opens its details. Under the list, what to do about a day that isn't right, where the days came
/// from, what the balance is, and when HR imported Zoho People's days.
class YourDaysCard extends StatelessWidget {
  const YourDaysCard({super.key, required this.month, required this.today, required this.onOpenDay, required this.onMyCorrections, required this.onAsk});

  final MyMonth month;
  final String today;
  final ValueChanged<String> onOpenDay;
  final VoidCallback onMyCorrections;
  final VoidCallback onAsk;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final m = month;
    final corrections = m.corrections != null;
    final usual = usualSourceOf(m.days);
    final small = text.bodyMedium?.copyWith(color: p.muted, height: 1.5);
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(eyebrow: monthNameOf(m.month), title: AttendanceWords.yourDays),
          if (corrections) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onMyCorrections,
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48), padding: const EdgeInsets.symmetric(horizontal: 10), textStyle: text.labelMedium),
                    child: const Text(AttendanceWords.myCorrections, textAlign: TextAlign.center),
                  ),
                ),
                if (monthAsks(m, today)) ...[
                  const SizedBox(width: 9),
                  Expanded(
                    child: FilledButton(
                      onPressed: onAsk,
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 48), padding: const EdgeInsets.symmetric(horizontal: 10), textStyle: text.labelMedium),
                      child: const Text(AttendanceWords.askCorrection, textAlign: TextAlign.center),
                    ),
                  ),
                ],
              ],
            ),
            if (m.correctable == false && m.correctableReason != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusControl)),
                child: Text(m.correctableReason!, style: small),
              ),
            ],
          ],
          const SizedBox(height: 18),
          if (m.days.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 26),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: p.line)),
              child: Text(AttendanceWords.notYet(monthNameOf(m.month)), textAlign: TextAlign.center, style: small),
            )
          else ...[
            Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: p.line)),
              child: Column(
                children: [
                  for (final (i, d) in m.days.indexed) _DayRow(day: d, month: m, last: i == m.days.length - 1, onTap: () => onOpenDay(d.date)),
                ],
              ),
            ),
            const SizedBox(height: 17),
            Text(corrections ? AttendanceWords.daysNote : AttendanceWords.daysNoteNoCorrections, style: small),
            if (usual != null) ...[const SizedBox(height: 4), Text(AttendanceWords.usualSource(AttendanceWords.sourceOf(usual)), style: small)],
            const SizedBox(height: 4),
            Text(AttendanceWords.balanceNote, style: small),
            if (m.importedAt != null) ...[const SizedBox(height: 4), Text(AttendanceWords.importedOn(AttendanceWords.dmy(isoDayOf(m.importedAt!))), style: small)],
          ],
        ],
      ),
    );
  }
}

class _DayRow extends StatelessWidget {
  const _DayRow({required this.day, required this.month, required this.last, required this.onTap});

  final DayRecord day;
  final MyMonth month;
  final bool last;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final d = day;
    final label = AttendanceWords.dayLabel(d.date);
    final balance = balanceOf(d);
    final notes = dayNotes(d, month);
    final open = month.openCorrectionOn(d.date);
    final cell = text.bodyMedium?.copyWith(height: 1.35, fontFeatures: const [FontFeature.tabularFigures()]);
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 82),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: p.line))),
          child: Semantics(
            button: true,
            child: Row(
              children: [
                SizedBox(
                  width: 81,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label.day, style: cell),
                      const SizedBox(height: 5),
                      Text(label.rest, style: text.bodySmall?.copyWith(height: 1.35)),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      StatusBadge(status: d.status),
                      for (final n in notes) ...[const SizedBox(height: 4), Text(n, style: text.bodySmall?.copyWith(height: 1.35))],
                      if (open != null) ...[
                        const SizedBox(height: 4),
                        Text(AttendanceWords.correctionOf(AttendanceWords.statusOfCorrection(open.status)), style: text.bodySmall?.copyWith(color: p.ink, height: 1.35)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 81,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(d.worked ? AttendanceWords.hoursText(d.hoursCounted) : '—', style: cell),
                      if (balance != null) ...[
                        const SizedBox(height: 4),
                        Semantics(
                          label: balance.short ? AttendanceWords.shortTitle : AttendanceWords.extraTitle,
                          child: Text(balance.text, style: text.bodySmall?.copyWith(height: 1.35, fontFeatures: const [FontFeature.tabularFigures()])),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// What a day's row says under what it was: working from home, official duty, exempt, a compensatory day or hours off,
/// corrected.
List<String> dayNotes(DayRecord d, MyMonth m) => [
  if (d.wfhDay || m.wfhDays.contains(d.date)) AttendanceWords.wfhDay,
  if (d.od != null) AttendanceWords.odDay,
  if (d.compensatory) AttendanceWords.compensatoryDayOff else if (d.exempt) AttendanceWords.exempt,
  if (d.compensatoryHours != null && d.compensatoryHours! > 0) AttendanceWords.compensatoryHours(d.compensatoryHours!),
  if (d.corrected) AttendanceWords.sourceOf('correction'),
];

/// What a day was: worked as the design's filled badge, leave as its outlined one, the rest in words (absent in red).
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final words = AttendanceWords.statusOf(status);
    if (status == 'worked' || status == 'leave') {
      final strong = status == 'worked';
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: strong ? p.primary : null,
          borderRadius: BorderRadius.circular(Tokens.radiusPill),
          border: strong ? null : Border.all(color: p.line),
        ),
        child: Text(words, style: text.labelMedium?.copyWith(color: strong ? p.onPrimary : p.ink, height: 1.35)),
      );
    }
    return Text(words, style: text.bodyMedium?.copyWith(color: status == 'absent' ? p.danger : p.ink, height: 1.35));
  }
}
