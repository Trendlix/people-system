import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../format.dart';
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';
import 'your_days.dart' show StatusBadge;

/// A day's details in the design's bottom sheet, as the website's table shows a day: what it was (with working from
/// home, official duty, exempt, a compensatory day or hours off, a correction's "corrected from …"), the check-in and
/// check-out each with its place, OD, Map and flags (a first day's note, an open check-in), its pairs and break, the
/// hours, the balance and permission, what Zoho says, where it came from, every press when there are more; then its
/// correction being decided, or Ask for a correction.
Future<void> showDaySheet(
  BuildContext context, {
  required MyMonth month,
  required String date,
  required String today,
  required VoidCallback onAsk,
  required VoidCallback onMyCorrections,
}) {
  // over the tab bar, as the design's sheets are
  final root = Navigator.of(context, rootNavigator: true).context;
  return showDesignSheet<void>(
    root,
    eyebrow: AttendanceWords.yourDay,
    title: AttendanceWords.dayTitle(date),
    builder: (context) => DayDetails(
      month: month,
      date: date,
      today: today,
      onAsk: () {
        Navigator.of(context).pop();
        onAsk();
      },
      onMyCorrections: () {
        Navigator.of(context).pop();
        onMyCorrections();
      },
    ),
  );
}

class DayDetails extends StatelessWidget {
  const DayDetails({super.key, required this.month, required this.date, required this.today, required this.onAsk, required this.onMyCorrections});

  final MyMonth month;
  final String date;
  final String today;
  final VoidCallback onAsk;
  final VoidCallback onMyCorrections;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final d = month.dayOn(date);
    final offer = offerFor(month, date, today);
    final facts = <(String, Widget)>[];
    if (d == null) {
      facts.add((AttendanceWords.whatItWas, Text(AttendanceWords.nothingOnRecord, style: text.bodyLarge)));
    } else {
      final presses = month.pressesOn(date);
      final inPress = pressAt(presses, d.checkIn, checkIn: true);
      final outPress = pressAt(presses, d.checkOut, checkIn: false);
      // the check-out's flags are its own press's; the check-in carries the rest
      final known = d.flags.where(AttendanceWords.flags.containsKey).toSet();
      final outFlags = (outPress?.flags ?? const <String>[]).where(known.contains).toSet();
      final inOwn = (inPress?.flags ?? const <String>[]).toSet();
      final inFlags = known.where((f) => !outFlags.contains(f) || inOwn.contains(f)).toSet();
      final pairs = pairsOf(d);
      final balance = balanceOf(d);
      final corrected = correctedNoteOf(d);
      final shownPresses = (inPress == null ? 0 : 1) + (outPress == null ? 0 : 1);
      final small = text.bodySmall;
      facts
        ..add((
          AttendanceWords.whatItWas,
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  StatusBadge(status: d.status),
                  if (d.wfhDay || month.wfhDays.contains(d.date)) const Pill(AttendanceWords.wfhDay),
                  if (d.od != null) Pill(AttendanceWords.odDayWhen(d.od!)),
                  if (d.compensatory)
                    Semantics(label: AttendanceWords.compensatoryDayTitle, child: const Pill(AttendanceWords.compensatoryDayOff))
                  else if (d.exempt)
                    Semantics(label: AttendanceWords.exemptDayTitle, excludeSemantics: true, child: const Pill(AttendanceWords.exempt)),
                  if (d.compensatoryHours != null && d.compensatoryHours! > 0)
                    Semantics(label: AttendanceWords.compensatoryHoursTitle, child: Pill(AttendanceWords.compensatoryHours(d.compensatoryHours!))),
                ],
              ),
              if (d.exempt && !d.compensatory) ...[const SizedBox(height: 6), Text(AttendanceWords.exemptDayTitle, style: small)],
              if (d.compensatory) ...[const SizedBox(height: 6), Text(AttendanceWords.compensatoryDayTitle, style: small)],
              if (corrected != null) ...[const SizedBox(height: 6), Text(corrected, style: small)],
            ],
          ),
        ))
        ..add((
          AttendanceWords.checkIn,
          _End(
            at: d.checkIn,
            missing: d.missingCheckIn,
            press: inPress,
            place: d.checkIn == null ? null : (inPress?.place ?? d.place),
            flags: inFlags,
            notes: [if (countedFromShiftStart(d)) AttendanceWords.firstDayNote(clockOf(d.checkIn!))],
          ),
        ))
        ..add((
          AttendanceWords.checkOut,
          _End(
            at: d.checkOut,
            missing: d.missingCheckOut && pairs?.open == null,
            press: outPress,
            place: outPress?.place,
            flags: outFlags,
            notes: [?pairs?.open, if (d.openHalfDay) AttendanceWords.halfDay],
          ),
        ));
      if (pairs != null) {
        facts.add((
          AttendanceWords.pairs,
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(pairs.pairs, style: text.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
              if (pairs.breakText != null) Text(pairs.breakText!, style: small),
            ],
          ),
        ));
      }
      facts
        ..add((AttendanceWords.hours, Text(d.worked ? AttendanceWords.hoursText(d.hoursCounted) : '—', style: text.bodyLarge)))
        ..add((
          AttendanceWords.balance,
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(balance?.text ?? '—', style: text.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
              if (balance != null) Text(balance.short ? AttendanceWords.shortTitle : AttendanceWords.extraTitle, style: small),
              if (d.permissionHours > 0) Text(AttendanceWords.permissionOf(AttendanceWords.hoursText(d.permissionHours)), style: small),
            ],
          ),
        ));
      if (d.zohoStatus != null) facts.add((AttendanceWords.zohoSays, Text(d.zohoStatus!, style: text.bodyLarge)));
      facts.add((AttendanceWords.cameFrom, Text(AttendanceWords.sourceOf(d.source), style: text.bodyLarge)));
      if (presses.length > shownPresses) {
        facts.add((
          AttendanceWords.allPresses(presses.length),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final x in presses) _End(at: x.at, missing: false, press: x, place: x.place, flags: x.flags.where(AttendanceWords.flags.containsKey).toSet(), notes: const [], label: true),
            ],
          ),
        ));
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, (label, value)) in facts.indexed)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(border: i == 0 ? null : Border(top: BorderSide(color: p.line))),
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: text.bodySmall),
                  const SizedBox(height: 4),
                  value,
                ],
              ),
            ),
          ),
        const SizedBox(height: 8),
        switch (offer) {
          OpenCorrection(:final correction) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(AttendanceWords.correction, style: text.bodySmall),
              const SizedBox(height: 4),
              Text(AttendanceWords.correctionOf(AttendanceWords.statusOfCorrection(correction.status)), style: text.bodyLarge),
              ArrowLink(AttendanceWords.myCorrections, onTap: onMyCorrections),
            ],
          ),
          CanAsk() => FilledButton(onPressed: onAsk, child: const Text(AttendanceWords.askCorrection)),
          NoOffer() => const SizedBox.shrink(),
        },
      ],
    );
  }
}

/// A check-in or check-out: its time (or Missing), its place, OD, Map; its flags; notes under it.
class _End extends StatelessWidget {
  const _End({required this.at, required this.missing, required this.press, required this.place, required this.flags, required this.notes, this.label = false});

  final DateTime? at;
  final bool missing;
  final MonthPress? press;
  final String? place;
  final Set<String> flags;
  final List<String> notes;

  /// Said as a press of the day's list: "In 09:05".
  final bool label;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final time = at;
    if (time == null && !missing) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('—', style: text.bodyLarge),
          for (final n in notes) Text(n, style: text.bodySmall),
        ],
      );
    }
    final map = press == null ? null : mapOf(press!);
    final clock = time == null ? '' : clockOf(time);
    return Padding(
      padding: EdgeInsets.only(bottom: label ? 6 : 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (time == null)
                Text(AttendanceWords.missing, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500))
              else
                Text(
                  label ? AttendanceWords.press(press?.checkIn ?? true, clock) : clock,
                  style: text.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              if (place != null)
                Text(
                  place == 'office' && press?.locationName != null
                      ? AttendanceWords.officeAt(press!.locationName!)
                      : AttendanceWords.pressPlace(place!, name: press?.locationName, kind: press?.locationKind),
                  style: text.bodySmall,
                ),
              if (press?.odRequestId != null)
                Semantics(label: AttendanceWords.odMarkTitle, excludeSemantics: true, child: const Pill(AttendanceWords.odMark)),
              if (map != null)
                Semantics(
                  button: true,
                  label: AttendanceWords.mapOf(press!.checkIn, clock),
                  excludeSemantics: true,
                  child: InkWell(
                    onTap: () => launchUrl(map, mode: LaunchMode.externalApplication),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 32),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
                        child: Text(
                          AttendanceWords.map,
                          style: text.bodySmall?.copyWith(color: p.ink, decoration: TextDecoration.underline, decorationColor: p.ink),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (flags.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final f in flags) Semantics(label: AttendanceWords.flags[f], excludeSemantics: true, child: Pill(AttendanceWords.flagsShort[f] ?? f)),
              ],
            ),
          ],
          for (final n in notes) ...[const SizedBox(height: 4), Text(n, style: text.bodySmall)],
        ],
      ),
    );
  }
}
