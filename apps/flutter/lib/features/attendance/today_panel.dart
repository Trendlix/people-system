import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../format.dart';
import '../../models/attendance_today.dart';
import '../../models/today.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import '../today/check_in_words.dart';
import '../today/press_flow.dart';
import '../today/today_controller.dart';
import 'attendance_data.dart';
import 'attendance_words.dart';

/// The Attendance tab's Today (the phone design, 30 October 2026; the website's My Attendance "Ready to start?"):
/// "TODAY · TUESDAY 27/10/2026" over where the day stands and its badge, the time now before a check-in and the time
/// worked after it, where, what today brings (working from home, exempt, the arrangement's place, a first day, the locks),
/// the one button and what a press came to; then today's check-ins. The same press as the Dashboard's (CheckInPress).
class TodayPanel extends ConsumerStatefulWidget {
  const TodayPanel({super.key});

  @override
  ConsumerState<TodayPanel> createState() => _TodayPanelState();
}

class _TodayPanelState extends ConsumerState<TodayPanel> with CheckInPress {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // the time moves on with the minute
    _tick = Timer.periodic(const Duration(seconds: 5), (_) => mounted ? setState(() {}) : null);
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  /// A press, then this month read again: today's day changed with it.
  @override
  Future<void> press() async {
    await super.press();
    if (mounted) ref.invalidate(attendanceMonthProvider(isoDayOf(ref.read(attendanceClockProvider)()).substring(0, 7)));
  }

  @override
  Widget build(BuildContext context) {
    final today = ref.watch(todayProvider);
    return today.when(
      skipLoadingOnRefresh: true,
      loading: () => const SurfaceCard(
        child: SizedBox(height: 240, child: Center(child: CircularProgressIndicator())),
      ),
      error: (e, _) => Notice(
        text: e is ApiException ? e.message : CheckInWords.loadFailed,
        ok: false,
        action: AttendanceWords.tryAgain,
        onAction: () => ref.invalidate(todayProvider),
      ),
      data: (t) => _Card(today: t, details: TodayDetails.of(t.raw), now: ref.read(attendanceClockProvider)(), busy: pressing, notice: notice, onPress: press),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.today, required this.details, required this.now, required this.busy, required this.notice, required this.onPress});

  final Today today;
  final TodayDetails details;
  final DateTime now;
  final bool busy;
  final PressNotice? notice;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final t = today;
    final d = details;
    final day = AttendanceWords.dayTitle(d.date ?? isoDayOf(now));
    final ins = [for (final (i, x) in t.punches.indexed) if (x.kind == PunchKind.checkIn) (i, x)];
    final open = t.next == PunchKind.checkOut && t.last?.kind == PunchKind.checkIn ? (t.punches.length - 1, t.last!) : null;
    final checkedOut = d.dayCheckOut ?? t.punches.where((x) => x.kind == PunchKind.checkOut).lastOrNull?.at;
    final hasIn = d.dayCheckIn != null || ins.isNotEmpty;

    // the badge: checked in (where), checked out, or not yet
    final (badge, strong) = t.next == PunchKind.checkOut
        ? (switch (open?.$2.place ?? d.dayPlace) {
            'office' => AttendanceWords.inOffice,
            'home' => AttendanceWords.atHome,
            'remote' => AttendanceWords.remote,
            _ => AttendanceWords.checkedIn,
          }, true)
        : (checkedOut != null ? AttendanceWords.checkedOut : AttendanceWords.notCheckedIn, false);
    final since = open?.$2.at ?? t.openSince ?? d.dayCheckIn;
    final headline = t.refusal != null
        ? AttendanceWords.checkingIn
        : t.next == PunchKind.checkOut && since != null
        ? AttendanceWords.checkedInAt(clockOf(since))
        : checkedOut != null
        ? AttendanceWords.checkedOutAt(clockOf(checkedOut))
        : AttendanceWords.readyToStart;

    // checked in or out today: the time worked; else the time now
    final counted = hasIn && (t.next == PunchKind.checkOut || checkedOut != null);
    final big = counted ? workClockOf(t.workedAt(now)) : clockOf(now);
    // the time worked in the owner's colours (31 October 2026: "below 80% color it red, from 80 to 90 color it yellow,
    // above 90% green"), as a share of the shift's hours a day
    final band = counted ? rateBandOf(t.shareAt(now)) : null;

    // where: today's check-in, else where the arrangement expects them
    final shown = open ?? ins.firstOrNull;
    String? where;
    if (shown != null) {
      final (i, x) = shown;
      where = x.place == 'office' && x.locationName != null
          ? AttendanceWords.officeAt(x.locationName!)
          : AttendanceWords.pressPlace(x.place, name: x.locationName, kind: i < d.locationKinds.length ? d.locationKinds[i] : null);
    } else if (d.dayCheckIn != null && d.dayPlace != null) {
      where = AttendanceWords.places[d.dayPlace] ?? d.dayPlace;
    } else if (t.officialDutyNow) {
      where = AttendanceWords.officialDuty;
    } else if (t.workingFromHome) {
      where = AttendanceWords.places['home'];
    } else if (d.expected == 'office') {
      where = AttendanceWords.places['office'];
    } else if (d.expected == 'anywhere') {
      where = AttendanceWords.anywhere;
    }

    // never a lock for someone exempt today (25 October 2026: "Optional check-in")
    final lock = d.exemption != null ? null : AttendanceWords.lockText(network: t.networkLocked, gps: t.gpsLocked, ownPlaces: d.ownPlaces);
    final arrangement = [?t.expectedText, CheckInWords.privacy].join(' ');
    final muted = text.bodyMedium?.copyWith(color: p.muted, height: 1.45);
    final notes = <Widget>[
      if (t.workingFromHome) const Align(alignment: Alignment.centerLeft, child: Pill(AttendanceWords.wfhToday)),
      if (d.exemption != null)
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Semantics(label: AttendanceWords.exemptionLabel, excludeSemantics: true, child: const Pill(AttendanceWords.exempt)),
            Text(AttendanceWords.exemptionWhen(d.exemption!), style: muted),
          ],
        ),
      Text(arrangement, style: text.bodyLarge?.copyWith(color: p.muted, height: 1.55)),
      if (d.firstDay) Text(AttendanceWords.firstDayToday(d.shiftStart), style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
      if (lock != null) Text(lock, style: text.bodyLarge),
      if (!d.officeLocationSet) Text(AttendanceWords.officeNotSet, style: text.bodySmall),
    ];

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Eyebrow(AttendanceWords.todayOf(day)),
                    const SizedBox(height: 5),
                    Text(headline, style: text.titleLarge),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Pill(badge, strong: strong),
            ],
          ),
          const SizedBox(height: 26),
          if (t.refusal != null)
            Text(t.refusal!, style: text.bodyLarge?.copyWith(color: p.muted))
          else ...[
            Text(counted ? AttendanceWords.timeWorked : AttendanceWords.currentTime, style: muted),
            const SizedBox(height: 9),
            Text(
              big,
              semanticsLabel: band == null ? null : '$big, ${CheckInWords.ofTheDay(t.shareAt(now))}',
              style: text.displayMedium?.copyWith(
                fontSize: 64,
                letterSpacing: -4.18,
                height: 1,
                color: band == null ? null : p.bandColour(band),
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            if (where != null) ...[const SizedBox(height: 8), Text(where, style: muted)],
            const SizedBox(height: 22),
            Divider(color: p.line, height: 1),
            const SizedBox(height: 20),
            for (final (i, n) in notes.indexed) ...[if (i > 0) const SizedBox(height: 10), n],
            const SizedBox(height: 17),
            _PressButton(next: t.next, busy: busy, onPress: onPress),
            if (notice case final n?) ...[const SizedBox(height: 12), Notice(text: n.text, ok: n.ok, action: n.action, onAction: n.onAction)],
            if (t.punches.isNotEmpty) ...[
              const SizedBox(height: 22),
              Divider(color: p.line, height: 1),
              const SizedBox(height: 16),
              _TodaysPresses(today: t, details: d),
            ],
          ],
        ],
      ),
    );
  }
}

/// The design's button: black "Check in" with the clock; once checked in, "Check out" outlined.
class _PressButton extends StatelessWidget {
  const _PressButton({required this.next, required this.busy, required this.onPress});

  final PunchKind next;
  final bool busy;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final checkIn = next == PunchKind.checkIn;
    final fg = checkIn ? p.onPrimary : p.ink;
    final label = busy ? CheckInWords.findingYou : (checkIn ? CheckInWords.checkIn : CheckInWords.checkOut);
    final radius = BorderRadius.circular(14);
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: checkIn ? p.primary : p.card,
        shape: RoundedRectangleBorder(borderRadius: radius, side: checkIn ? BorderSide.none : BorderSide(color: p.ink)),
        child: InkWell(
          onTap: busy ? null : onPress,
          borderRadius: radius,
          child: SizedBox(
            height: Tokens.buttonHeight,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (busy)
                  SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                else
                  Icon(checkIn ? CupertinoIcons.clock : CupertinoIcons.square_arrow_left, size: 17, color: fg),
                const SizedBox(width: 8),
                Flexible(child: Text(label, style: text.labelLarge?.copyWith(color: fg))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Today's check-ins: each in or out, its time, where, and its flags; the break between the pairs, not counted.
class _TodaysPresses extends StatelessWidget {
  const _TodaysPresses({required this.today, required this.details});

  final Today today;
  final TodayDetails details;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final breakMinutes = details.breakMinutes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(AttendanceWords.todaysCheckIns, style: text.titleSmall),
        if (breakMinutes != null && breakMinutes > 0)
          Text(AttendanceWords.breakNotCounted(AttendanceWords.breakOf(breakMinutes)), style: text.bodySmall),
        const SizedBox(height: 4),
        for (final (i, x) in today.punches.indexed)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              border: i == 0 ? null : Border(top: BorderSide(color: p.line)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(x.kind == PunchKind.checkIn ? AttendanceWords.checkIn : AttendanceWords.checkOut, style: text.bodyMedium),
                    const SizedBox(width: 8),
                    Text(clockOf(x.at), style: text.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        x.place == 'office' && x.locationName != null
                            ? AttendanceWords.officeAt(x.locationName!)
                            : AttendanceWords.pressPlace(x.place, name: x.locationName, kind: i < details.locationKinds.length ? details.locationKinds[i] : null),
                        style: text.bodySmall,
                        textAlign: TextAlign.end,
                      ),
                    ),
                  ],
                ),
                if (x.flags.any(AttendanceWords.flags.containsKey)) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final f in x.flags.toSet())
                        if (AttendanceWords.flags.containsKey(f))
                          Semantics(label: AttendanceWords.flags[f], excludeSemantics: true, child: Pill(AttendanceWords.flagsShort[f]!)),
                    ],
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}
