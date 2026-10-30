import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../format.dart';
import '../../../models/request_forms.dart';
import '../../../models/requests.dart';
import '../../../theme/tokens.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests"): work for the company away from the office, e.g.
// at a client's site, asked ahead or up to 3 days after; on a single rest day or official holiday with its compensation
// (a day off, hours off for part of the day, or cash instead). Its sheet (the phone design's bottom sheet) and its page,
// as the website's (apps/web attendance/official-duty: od.ts, od-forms.tsx, [id]/od-request.tsx; packages/shared
// official-duty.ts). People checks everything again when it is sent (leave, work from home and other duties on its days
// only People knows).

/// Official duty's words, People's where it has them.
abstract final class OdWords {
  static const title = 'Official duty';
  static String intro(bool toCeo) =>
      'Work for the company away from the office, e.g. at a client’s site: ask ahead, or up to 3 days after. Your direct manager decides first, then ${toCeo ? 'the CEO' : 'HR'}.';
  static String shiftNote(String start, String end) => 'Your shift is $start to $end: part of a day is within it. Asked ahead, today or up to 3 days after.';
  static const howLong = 'How long';
  static const fullDays = 'Full days';
  static const partOfADay = 'Part of a day';
  static const firstDay = 'First day';
  static const day = 'Day';
  static const firstDayHint = 'A working day of your shift, or a single rest day or official holiday with its compensation: ahead, today, or up to 3 days gone by.';
  static const lastDay = 'Last day';
  static const lastDayHint =
      'For several days in a row, up to 31: their official holidays and rest days aren’t duty days. A single rest day or official holiday goes on its own, with its compensation.';
  static const from = 'From';
  static const to = 'To';
  static const timesHint = 'Within your shift. Within these hours you check in from where you are; outside them, as on any day.';
  static const where = 'Where';
  static const whereHint = 'E.g. the client’s office in New Cairo, or the shoot’s location. Up to 200 characters.';
  static const reason = 'Reason';
  static const reasonHint = 'What the duty is for. Your direct manager and HR read it. Up to 1000 characters.';
  static const askedAfter =
      'Asked after the day: it is marked “requested after”. That’s fine up to 3 days after; the reason tells your manager and HR why it wasn’t asked ahead.';

  // the compensation
  static const compensation = 'Compensation';
  static String what(String day, String? holiday) => '$day is ${holiday != null ? 'an official holiday ($holiday)' : 'a rest day of your shift'}';
  static String compensatedAlready(String what, String status) => '$what, compensated already by a compensatory day ($status): there is nothing more to choose.';
  static String earnsNothing(String what, String hours, String min) =>
      '$what: $hours of official duty on it earns nothing, fewer than the $min that earn a compensation (Compensatory Setup), so there is no compensation to choose.';
  static String earns(String what, String earned, String cash) => '$what: official duty on it earns $earned, or $cash instead. The day itself adds no hours or overtime.';
  static const aWholeDayOff = 'a whole day off';
  static String hoursOff(String hours) => '$hours off';
  static const dayOff = 'Day off';
  static const hoursOffChoice = 'Hours off';
  static const cashInstead = 'Cash instead';
  static const dayForTheHoursOff = 'Day for the hours off';
  static String dayOffHint(String window, String? hours) => 'A working day of your shift $window, from tomorrow on.${hours == null ? '' : ' The $hours off are taken that day, with no deduction.'}';
  static const inTheSameMonth = 'in the same month';
  static String withinDaysAfter(int n) => 'within $n ${n == 1 ? 'day' : 'days'} after it';
  static String cashHint(String cash) => 'Cash instead: $cash added to the month’s payroll once approved, and no day off.';
  static String hoursPay(String hours, double h, String rate) => '$hours${h == 1 ? '’s' : '’'} pay at $rate×';
  static String daysPay(double n, String days) => n == 1 ? '1 day’s pay' : '$days days’ pay';

  // the checks (People's words, packages/shared official-duty.ts and the website's form)
  static const enterDay = 'Enter the day of the official duty.';
  static String tooLate(String day, String earliest) => '$day is more than 3 days ago: ask for an official duty ahead, or within 3 days after the day (from $earliest).';
  static const lastBeforeFirst = 'The last day can’t be before the first.';
  static String atMost31(int days) => 'Ask for at most 31 days at once: this is $days days.';
  static const chooseStart = 'Choose the time it starts, e.g. 10:00 AM.';
  static const chooseEnd = 'Choose the time it ends, e.g. 2:00 PM.';
  static const endAfterStart = 'The time it ends must be after the time it starts.';
  static const noShift = 'You have no shift, so part of a day can’t be checked against it: ask for the full day.';
  static String withinShift(String start, String end) => 'Choose times within your shift, $start to $end.';
  static String noWorkingDay(String from, String to) => 'None of the days from $from to $to is a working day of your shift: there is no work to be away for.';
  static const enterDayOff = 'Enter the day off, e.g. 10/11/2026.';
  static String dayOffHoliday(String day, String name) => '$day is an official holiday ($name): the day off must be a working day.';
  static String dayOffRest(String day) => '$day is a rest day of your shift: the day off must be a working day.';
  static String sameMonth(String worked, String workedMonth, String off, String offMonth) =>
      'The day off must be in the same month as the day worked: $worked is in $workedMonth, $off in $offMonth.';
  static String withinDays(int n, String from, String to) => 'The day off must be within $n ${n == 1 ? 'day' : 'days'} after the day worked: from $from to $to.';
  static String goneBy(String day) => '$day has gone by: only HR records a day off that is past.';
  static String isToday(String day) => '$day is today: ask for a compensatory day a day before the day off at the latest.';
  static const writePlace = 'Write where the official duty is, e.g. the client’s office in New Cairo.';
  static const writeReason = 'Write what the official duty is for, e.g. a site visit for the client’s launch.';
  static String ready(String when, String compensation, bool toCeo) =>
      'Ready to send: official duty for $when$compensation, to your direct manager (without one, your lead), then ${toCeo ? 'the CEO' : 'HR'}.';
  static String withDayOffOn(String day) => ', with a day off on $day';
  static String withHoursOffOn(String hours, String day) => ', with $hours off on $day';
  static const withADayOff = ', with a day off';
  static String paidInstead(String cash) => ', paid $cash instead';

  // its page
  static const days = 'Days';
  static const whereFact = 'Where';
  static const reasonFact = 'Reason';
  static const compensationFact = 'Compensation';
  static const compensationNote = 'For working a rest day or an official holiday: decided and cancelled with this official duty. The day itself adds no hours or overtime.';
  static const asked = 'Asked';
  static const askedAfterFact = 'After its first day: requested after, within the 3 days allowed.';
  static const requestedAfter = 'Requested after';
  static const aFullDay = 'A full day';
  static String daysInARow(int n) => '$n days in a row, full days';
  static const compensatedBelow = 'on a rest day or an official holiday, compensated below';
  static const workingDayAway = 'a working day away from the office, not leave';
  static String cashInsteadOf(String off) => 'Cash instead of $off';
  static const aDayOff = 'a day off';
  static const imported = 'Imported';
  static const askedByTheEmployee = 'Asked';
  static const approvedNote =
      'On its days (or within its hours) you check in from where you are, without the office location or network, and the days count as attended for its hours.';
  static const others = 'Your other official duty requests are on My Requests.';
  static const stepImported = 'Imported, approved';
  static const stepCancelled = 'Cancelled';
  static const cancelTitle = 'Cancel the request';
  static const cancelExplain = 'While it is being decided you can cancel it, e.g. when the visit is called off.';
  static String cancelExplainWith(String comp) => ' Its compensation ($comp) is cancelled with it.';
  static const cancelButton = 'Cancel this request';
  static String cancelConfirm(String when) => 'Cancel your official duty request for $when? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Official duty cancelled. It stays on the list, cancelled; its days are free again.';
}

/// Opens the sheet to ask for an official duty, from the tab's [context].
Future<void> showOdSheet(BuildContext context) => openRequestSheet(
  context,
  title: OdWords.title,
  icon: kindIcons[RequestKind.od]!,
  builder: (sheetContext, sent) => _OdForm(sent: sent),
);

// ---------- what a day earns ----------

/// What official duty on a rest day or an official holiday earns: a whole day, hours off, or nothing (too few hours).
typedef _Earned = ({bool day, double hours});

int _minutes(String hhmm) {
  final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(hhmm);
  return m == null ? 0 : int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

/// The hours from one time to another (past midnight for a night's).
double _hoursBetween(String from, String to) {
  var d = _minutes(to) - _minutes(from);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

String _number(double n) {
  final r = (n * 100).round() / 100;
  return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
}

/// Compensatory Setup's reading of the hours (a full day earns a whole one).
_Earned? _earned(CompensatoryRules rules, double? hours) {
  if (hours == null || hours >= rules.fullDayHours) return (day: true, hours: 0);
  if (hours < rules.minHours) return null;
  return (day: false, hours: hours < rules.hoursCap ? hours : rules.hoursCap);
}

/// "4 hours' pay at 1.5×", "1.5 days' pay".
String _cashText(_Earned e, double rate) =>
    e.day ? OdWords.daysPay(rate, _number(rate)) : OdWords.hoursPay(hoursShort(e.hours), e.hours, _number(rate));

// ---------- the sheet ----------

class _OdForm extends ConsumerStatefulWidget {
  const _OdForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_OdForm> createState() => _OdFormState();
}

class _OdFormState extends ConsumerState<_OdForm> {
  final _place = TextEditingController();
  final _reason = TextEditingController();
  bool _seeded = false;
  bool _part = false;
  String? _start;
  String? _end;
  String? _from;
  String? _to;
  String _compensation = 'day_off';
  String? _dayOff;
  bool _dayOffByHand = false;
  bool _busy = false;
  List<String> _refusal = const [];

  /// Days People said are compensated already (its refusal), as the website reads them.
  final _compensatedSaid = <String, String>{};

  @override
  void dispose() {
    _place.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool _working(OdForm f, String d) => f.workingDays.contains(weekdayIndex(d)) && !f.holidays.any((h) => h.date == d);

  /// The smart defaults, once the form is read: the first working day from today, the shift's hours.
  void _seed(OdForm f) {
    _seeded = true;
    var d = f.today;
    for (var i = 0; i < 14 && !_working(f, d); i++) {
      d = addDays(d, 1);
    }
    _start = _working(f, d) ? d : f.today;
    _from = f.shift?.startTime;
    _to = f.shift?.endTime;
  }

  /// The day off first offered: the next working day from tomorrow inside the window after the day worked.
  String? _defaultDayOff(OdForm f, String worked) {
    final within = f.rules?.offWithinDays;
    var d = addDays(f.today, 1);
    if (d.compareTo(worked) <= 0) d = addDays(worked, 1);
    for (var i = 0; i < 62; i++, d = addDays(d, 1)) {
      final inWindow = within == null ? d.substring(0, 7) == worked.substring(0, 7) : daysBetween(worked, d) <= within;
      if (!inWindow) return null;
      if (_working(f, d)) return d;
    }
    return null;
  }

  /// The compensation part, for a single rest day or official holiday: what it earns, whether it is needed.
  ({String what, String? status, _Earned? earned, bool needed})? _comp(OdForm f) {
    final s = _start;
    final rules = f.rules;
    if (s == null || rules == null) return null;
    if (!_part && _end != null && _end != s) return null;
    final holiday = f.holidays.where((h) => h.date == s).firstOrNull;
    if (holiday == null && f.workingDays.contains(weekdayIndex(s))) return null;
    final status = f.compensated.where((c) => c.date == s).firstOrNull?.status ?? _compensatedSaid[s];
    final hours = _part && _from != null && _to != null ? _hoursBetween(_from!, _to!) : null;
    final earned = _earned(rules, hours);
    return (what: OdWords.what(dayWords(s), holiday?.name), status: status, earned: earned, needed: status == null && earned != null);
  }

  List<String> _problems(OdForm f, ({String what, String? status, _Earned? earned, bool needed})? comp) {
    final out = <String>[];
    final s = _start;
    if (f.refusal != null) return [f.refusal!];
    if (s == null) return [OdWords.enterDay];
    final end = _part ? s : (_end ?? s);
    if (s.compareTo(f.earliest) < 0) out.add(OdWords.tooLate(dmy(s), dmy(f.earliest)));
    if (end.compareTo(s) < 0) {
      out.add(OdWords.lastBeforeFirst);
    } else if (daysBetween(s, end) + 1 > 31) {
      out.add(OdWords.atMost31(daysBetween(s, end) + 1));
    } else if (end != s) {
      var any = false;
      for (var d = s; d.compareTo(end) <= 0; d = addDays(d, 1)) {
        any = any || _working(f, d);
      }
      if (!any) out.add(OdWords.noWorkingDay(dmy(s), dmy(end)));
    }
    if (_part) {
      final shift = f.shift;
      if (_from == null) out.add(OdWords.chooseStart);
      if (_to == null) out.add(OdWords.chooseEnd);
      if (shift == null) {
        out.add(OdWords.noShift);
      } else if (_from != null && _to != null) {
        final dayShift = _minutes(shift.startTime) < _minutes(shift.endTime);
        if (dayShift && _minutes(_to!) <= _minutes(_from!)) {
          out.add(OdWords.endAfterStart);
        } else if (dayShift && (_minutes(_from!) < _minutes(shift.startTime) || _minutes(_to!) > _minutes(shift.endTime) + shift.graceMinutes)) {
          out.add(OdWords.withinShift(time12(shift.startTime), time12(shift.endTime)));
        }
      }
    }
    if (comp != null && comp.needed && _compensation == 'day_off') {
      final off = _dayOff;
      if (off == null) {
        out.add(OdWords.enterDayOff);
      } else {
        final holiday = f.holidays.where((h) => h.date == off).firstOrNull;
        if (holiday != null) {
          out.add(OdWords.dayOffHoliday(dmy(off), holiday.name));
        } else if (!f.workingDays.contains(weekdayIndex(off))) {
          out.add(OdWords.dayOffRest(dmy(off)));
        }
        final within = f.rules?.offWithinDays;
        if (within == null && off.substring(0, 7) != s.substring(0, 7)) {
          out.add(OdWords.sameMonth(dmy(s), monthNameOf(s.substring(0, 7)), dmy(off), monthNameOf(off.substring(0, 7))));
        } else if (within != null && (daysBetween(s, off) < 1 || daysBetween(s, off) > within)) {
          out.add(OdWords.withinDays(within, dmy(addDays(s, 1)), dmy(addDays(s, within))));
        }
        if (off.compareTo(f.today) < 0) out.add(OdWords.goneBy(dmy(off)));
        if (off == f.today) out.add(OdWords.isToday(dmy(off)));
      }
    }
    if (_place.text.trim().isEmpty) out.add(OdWords.writePlace);
    if (_reason.text.trim().isEmpty) out.add(OdWords.writeReason);
    return out;
  }

  String _ready(OdForm f, ({String what, String? status, _Earned? earned, bool needed})? comp) {
    final s = _start!;
    final end = _part ? s : (_end ?? s);
    final when = odWhenWords(s, end, !_part, _part ? _from : null, _part ? _to : null);
    var words = '';
    final earned = comp?.earned;
    if (comp != null && comp.needed && earned != null) {
      if (_compensation == 'cash') {
        words = OdWords.paidInstead(_cashText(earned, f.rules!.cashRate));
      } else if (_dayOff == null) {
        words = OdWords.withADayOff;
      } else {
        words = earned.day ? OdWords.withDayOffOn(dayWords(_dayOff!)) : OdWords.withHoursOffOn(hoursShort(earned.hours), dayWords(_dayOff!));
      }
    }
    return OdWords.ready(when, words, f.toCeo);
  }

  Future<void> _send(OdForm f, bool needed) async {
    final s = _start!;
    final body = <String, Object?>{
      'startDate': s,
      'endDate': _part ? s : (_end ?? s),
      'fullDay': !_part,
      if (_part) 'fromTime': _from,
      if (_part) 'toTime': _to,
      'place': _place.text.trim(),
      'reason': _reason.text.trim(),
      if (needed) 'compensation': _compensation,
      if (needed && _compensation == 'day_off' && _dayOff != null) 'dayOff': _dayOff,
    };
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.od), body);
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.od, json);
      widget.sent(made, sentTextOf(made));
    } on Object catch (e) {
      if (!mounted) return;
      final said = refusalOf(e);
      // "…, compensated already by a compensatory day (approved)…": no compensation is asked for that day any more
      for (final m in said) {
        final hit = RegExp(r'(\d{2})/(\d{2})/(\d{4})[^,]*, compensated already by a compensatory day \(([^)]+)\)').firstMatch(m);
        if (hit != null) _compensatedSaid['${hit[3]}-${hit[2]}-${hit[1]}'] = hit[4]!;
      }
      setState(() {
        _busy = false;
        _refusal = said;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(odFormProvider);
    return switch (form) {
      AsyncData(:final value) => _body(context, value),
      AsyncError() => SheetState.failed(onRetry: () => ref.invalidate(odFormProvider)),
      _ => const SheetState.loading(),
    };
  }

  Widget _body(BuildContext context, OdForm f) {
    if (f.refusal != null) return SheetState.refused(f.refusal!);
    if (!_seeded) _seed(f);
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final comp = _comp(f);
    final earned = comp?.earned;
    if (comp != null && comp.needed && _dayOff == null && !_dayOffByHand) _dayOff = _defaultDayOff(f, _start!);
    final problems = _problems(f, comp);
    final rate = f.rules?.cashRate ?? 1.5;
    final window = f.rules?.offWithinDays == null ? OdWords.inTheSameMonth : OdWords.withinDaysAfter(f.rules!.offWithinDays!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(OdWords.intro(f.toCeo), style: text.bodyLarge?.copyWith(color: p.muted)),
        const SizedBox(height: 20),
        if (f.shift != null) RulesNote(icon: CupertinoIcons.clock, lines: [OdWords.shiftNote(time12(f.shift!.startTime), time12(f.shift!.endTime))]),
        SheetField(
          label: OdWords.howLong,
          child: ChoicePills<bool>(
            values: const [false, true],
            labelOf: (part) => part ? OdWords.partOfADay : OdWords.fullDays,
            selected: _part,
            onChanged: (part) => setState(() => _part = part),
          ),
        ),
        SheetField(
          label: _part ? OdWords.day : OdWords.firstDay,
          hint: OdWords.firstDayHint,
          child: PickDayField(
            label: _part ? OdWords.day : OdWords.firstDay,
            value: _start,
            first: f.earliest,
            last: addDays(f.today, 366),
            onChanged: (d) => setState(() {
              // the last day moves with the first
              if (_end != null && _start != null) _end = addDays(_end!, daysBetween(_start!, d));
              _start = d;
              if (!_dayOffByHand) _dayOff = null;
            }),
          ),
        ),
        if (_part)
          SheetField(
            label: '${OdWords.from} · ${OdWords.to}',
            hint: OdWords.timesHint,
            child: Row(
              children: [
                Expanded(
                  child: PickTimeField(label: OdWords.from, value: _from, onChanged: (t) => setState(() => _from = t)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: PickTimeField(label: OdWords.to, value: _to, onChanged: (t) => setState(() => _to = t)),
                ),
              ],
            ),
          )
        else
          SheetField(
            label: OdWords.lastDay,
            optional: true,
            hint: OdWords.lastDayHint,
            child: PickDayField(
              label: OdWords.lastDay,
              value: _end,
              first: _start ?? f.earliest,
              last: addDays(_start ?? f.today, 30),
              onChanged: (d) => setState(() => _end = d),
              onClear: () => setState(() => _end = null),
            ),
          ),
        if (comp != null)
          SheetField(
            label: OdWords.compensation,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  comp.status != null
                      ? OdWords.compensatedAlready(comp.what, comp.status!)
                      : earned == null
                      ? OdWords.earnsNothing(comp.what, hoursShort(_hoursBetween(_from!, _to!)), hoursShort(f.rules!.minHours))
                      : OdWords.earns(comp.what, earned.day ? OdWords.aWholeDayOff : OdWords.hoursOff(hoursShort(earned.hours)), _cashText(earned, rate)),
                  style: text.bodyMedium,
                ),
                if (comp.needed && earned != null) ...[
                  const SizedBox(height: 12),
                  ChoicePills<String>(
                    values: const ['day_off', 'cash'],
                    labelOf: (c) => c == 'cash' ? OdWords.cashInstead : (earned.day ? OdWords.dayOff : OdWords.hoursOffChoice),
                    selected: _compensation,
                    onChanged: (c) => setState(() => _compensation = c),
                  ),
                  const SizedBox(height: 14),
                  if (_compensation == 'day_off')
                    SheetField(
                      label: earned.day ? OdWords.dayOff : OdWords.dayForTheHoursOff,
                      hint: OdWords.dayOffHint(window, earned.day ? null : hoursShort(earned.hours)),
                      child: PickDayField(
                        label: earned.day ? OdWords.dayOff : OdWords.dayForTheHoursOff,
                        value: _dayOff,
                        first: addDays(f.today, 1),
                        last: addDays(f.today, 120),
                        onChanged: (d) => setState(() {
                          _dayOff = d;
                          _dayOffByHand = true;
                        }),
                      ),
                    )
                  else
                    Text(OdWords.cashHint(_cashText(earned, rate)), style: text.bodySmall),
                ],
              ],
            ),
          ),
        SheetField(
          label: OdWords.where,
          hint: OdWords.whereHint,
          child: SheetTextBox(controller: _place, label: OdWords.where, max: 200, onChanged: (_) => setState(() {})),
        ),
        SheetField(
          label: OdWords.reason,
          hint: OdWords.reasonHint,
          child: SheetTextBox(controller: _reason, label: OdWords.reason, lines: 3, max: 1000, onChanged: (_) => setState(() {})),
        ),
        if (_start != null && _start!.compareTo(f.today) < 0) RulesNote(icon: CupertinoIcons.exclamationmark_circle, lines: const [OdWords.askedAfter]),
        SendChecks(problems: problems, ready: problems.isEmpty ? _ready(f, comp) : null),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty ? () => _send(f, comp?.needed ?? false) : null),
        const SizedBox(height: Tokens.gapSmall),
      ],
    );
  }
}

// ---------- its page ----------

/// A full day, Part of a day, 3 days in a row, full days.
String _spanText(OdRequest r) {
  if (r.startDate == r.endDate) return r.fullDay ? OdWords.aFullDay : OdWords.partOfADay;
  return OdWords.daysInARow(daysBetween(r.startDate, r.endDate) + 1);
}

/// "A day off on Tuesday 10/11/2026", "Cash instead of 4 hours off".
String _compensationText(OdCompensation c) {
  final off = c.hoursOff != null && c.hoursOff! > 0 ? OdWords.hoursOff(hoursShort(c.hoursOff!)) : OdWords.aDayOff;
  if (c.outcome == 'cash') return OdWords.cashInsteadOf(off);
  final what = off[0].toUpperCase() + off.substring(1);
  return c.dayOff == null ? what : '$what on ${dayWords(c.dayOff!)}';
}

/// What an official duty's page shows.
RequestDetail odDetail(OdRequest r) {
  final when = odWhenWords(r.startDate, r.endDate, r.fullDay, r.fromTime, r.toTime);
  final comp = r.compensation;
  final byHr = r.recordedByHr || r.imported;
  final source = r.imported ? OdWords.imported : (r.recordedByHr ? RequestsWords.recordedByHr : OdWords.askedByTheEmployee);
  return basicDetail(
    r,
    title: OdWords.title,
    subline: '$source ${dateTimeWords(r.createdAt)}',
    progress: r.status == 'approved' && r.imported ? OdWords.imported : null,
    facts: [
      (
        label: r.startDate == r.endDate ? OdWords.day : OdWords.days,
        value: when,
        note: '${_spanText(r)}: ${comp != null ? OdWords.compensatedBelow : OdWords.workingDayAway}',
      ),
      (label: OdWords.whereFact, value: r.dutyPlace, note: null),
      (label: OdWords.reasonFact, value: r.reason, note: null),
      if (comp != null)
        (
          label: OdWords.compensationFact,
          value: '${_compensationText(comp)} · ${RequestsWords.statusLabels[comp.status] ?? comp.status}',
          note: OdWords.compensationNote,
        ),
      if (r.late && !byHr) (label: OdWords.asked, value: OdWords.askedAfterFact, note: null),
    ],
    stepText: (s) => switch (s.kind) {
      'imported' => OdWords.stepImported,
      'cancelled' => OdWords.stepCancelled,
      _ => stepTextOf(s, r.manager, r.confidential),
    },
    notes: [if (r.status == 'approved') OdWords.approvedNote, OdWords.others],
    actions: [
      if (r.canCancel)
        (
          title: OdWords.cancelTitle,
          explain: '${OdWords.cancelExplain}${comp == null ? '' : OdWords.cancelExplainWith(_compensationText(comp).toLowerCase())}',
          button: OdWords.cancelButton,
          confirm: OdWords.cancelConfirm(when),
          path: RequestPaths.action(RequestKind.od, r.id, 'cancel'),
          done: OdWords.cancelled,
        ),
    ],
  );
}
