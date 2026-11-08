import 'package:flutter/material.dart';

import '../../format.dart';
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';

/// "Your days" (the phone design, 30 October 2026; the website's My Attendance table): My corrections and Ask for a
/// correction (while the month's payroll isn't approved, else why not), every day kept, each its day and date, what it
/// was (worked and leave as badges; working from home, official duty, exempt, a correction under it), and on a day
/// worked its check-in and check-out, its attendance percentage and its hours with its balance (8 November 2026); a day
/// opens its details.
class YourDaysCard extends StatelessWidget {
  const YourDaysCard({super.key, required this.month, required this.today, required this.onOpenDay, required this.onMyCorrections, required this.onAsk, this.selected});

  final MyMonth month;
  final String today;
  final ValueChanged<String> onOpenDay;
  final VoidCallback onMyCorrections;
  final VoidCallback onAsk;

  /// The day shown beside the calendar on an iPad (8 November 2026): its row marked.
  final String? selected;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final m = month;
    final corrections = m.corrections != null;
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
          else
            Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: p.line)),
              child: Column(
                children: [
                  for (final (i, d) in m.days.indexed)
                    _DayRow(day: d, month: m, last: i == m.days.length - 1, selected: d.date == selected, onTap: () => onOpenDay(d.date)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A day's row (owner, 8 November 2026: "show the checking time and the checkout time with the attendance percentage
/// without expandding the field"): its date and what it was, and on a day worked its attendance percentage beside them
/// (dayRateOf, in the owner's colours); under them its check-in and check-out (the first in and the last out, one People
/// finds missing said so) with its hours, then its notes with its balance. A day not worked stays its date and what it
/// was. Two lines, so a 360-point phone fits it at larger text too; the same in the iPad's pane.
class _DayRow extends StatelessWidget {
  const _DayRow({required this.day, required this.month, required this.last, required this.onTap, this.selected = false});

  final DayRecord day;
  final MyMonth month;
  final bool last;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final d = day;
    const tabular = [FontFeature.tabularFigures()];
    final balance = balanceOf(d);
    final open = month.openCorrectionOn(d.date);
    final rate = dayRateOf(d);
    final band = rateBandOf(rate);
    final times = rowTimesOf(d);
    // an open check-in after the day's pairs (the check-out shown is its last pair's), as its details say it
    final openPress = pairsOf(d)?.open;
    final cell = text.bodyMedium?.copyWith(height: 1.35, fontFeatures: tabular);
    final small = text.bodySmall?.copyWith(height: 1.35);
    // a check-in or check-out People finds missing, as the website's day says it (in the warning colour)
    final missing = cell?.copyWith(color: p.warn, fontWeight: FontWeight.w500);
    final notes = <Widget>[
      for (final n in dayNotes(d, month)) Text(n, style: small),
      if (openPress != null) Text(openPress, style: small?.copyWith(color: p.warn)),
      if (open != null) Text(AttendanceWords.correctionOf(AttendanceWords.statusOfCorrection(open.status)), style: small?.copyWith(color: p.ink)),
    ];
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 60),
          // a day of one line (rest, leave, a holiday) in the middle of its height
          alignment: AlignmentDirectional.centerStart,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
          decoration: BoxDecoration(color: selected ? p.track : null, border: last ? null : Border(bottom: BorderSide(color: p.line))),
          child: Semantics(
            button: true,
            selected: selected,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // the date and what it was (the badge under the date when the words are too large for one line), and
                // on a day worked its percentage
                Row(
                  children: [
                    Expanded(
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(AttendanceWords.dayLabel(d.date), style: cell?.copyWith(fontWeight: FontWeight.w500)),
                          StatusBadge(status: d.status),
                        ],
                      ),
                    ),
                    if (rate != null) ...[
                      const SizedBox(width: 10),
                      Semantics(
                        label: AttendanceWords.dayRateLabel(AttendanceWords.percent(rate)),
                        excludeSemantics: true,
                        child: Text(
                          AttendanceWords.percent(rate),
                          style: text.titleSmall?.copyWith(height: 1.35, color: band == null ? null : p.bandColour(band), fontFeatures: tabular),
                        ),
                      ),
                    ],
                  ],
                ),
                if (d.worked) ...[
                  const SizedBox(height: 7),
                  // its check-in and check-out (else its first note: exempt, official duty…) with its hours on the
                  // right; each on a line of its own, so the times keep to one line on a phone at larger text
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: times == null
                            ? (notes.firstOrNull ?? const SizedBox.shrink())
                            : Semantics(
                                label: AttendanceWords.rowTimesLabel(times.checkIn, times.checkOut),
                                excludeSemantics: true,
                                child: times.noCheckIn || times.noCheckOut
                                    ? Text.rich(
                                        TextSpan(
                                          children: [
                                            TextSpan(text: times.checkIn ?? AttendanceWords.noCheckIn, style: times.noCheckIn ? missing : null),
                                            const TextSpan(text: ' – '),
                                            TextSpan(text: times.checkOut ?? AttendanceWords.noCheckOut, style: times.noCheckOut ? missing : null),
                                          ],
                                        ),
                                        style: cell,
                                      )
                                    : Text(AttendanceWords.rowTimes(times.checkIn, times.checkOut), style: cell),
                              ),
                      ),
                      const SizedBox(width: 10),
                      Semantics(
                        label: AttendanceWords.hoursLabel(AttendanceWords.hoursText(d.hoursCounted)),
                        excludeSemantics: true,
                        child: Text(AttendanceWords.hoursText(d.hoursCounted), style: cell),
                      ),
                    ],
                  ),
                  // its other notes, with its balance on the right
                  if (notes.length > (times == null ? 1 : 0) || balance != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (final (i, n) in notes.skip(times == null ? 1 : 0).indexed) ...[if (i > 0) const SizedBox(height: 4), n],
                            ],
                          ),
                        ),
                        if (balance != null) ...[
                          const SizedBox(width: 10),
                          Semantics(
                            label: balance.short ? AttendanceWords.shortTitle : AttendanceWords.extraTitle,
                            child: Text(balance.text, style: small?.copyWith(fontFeatures: tabular)),
                          ),
                        ],
                      ],
                    ),
                  ],
                ] else
                  for (final n in notes) ...[const SizedBox(height: 4), n],
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
