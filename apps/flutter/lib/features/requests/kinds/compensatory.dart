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

// A compensatory day (owner, 26 October 2026: "WFH and compensatory pages in the phone app"): a day off in exchange for
// a rest day or an official holiday worked, or hours off for part of one, asked a day before the day off at the latest.
// Its sheet (the phone design's bottom sheet) and its page, as the website's (apps/web attendance/compensatory:
// compensatory.ts, compensatory-forms.tsx, [id]/compensatory-request.tsx; packages/shared compensatory.ts). People checks
// everything again when it is sent; HR decides it as a day off or, rarely, pays it in cash instead.

/// The compensatory day's words, People's where it has them.
abstract final class CompensatoryWords {
  static const title = 'Compensatory day';
  static String intro(bool toCeo) =>
      'A day off for a rest day or an official holiday you worked, asked a day before at the latest. Your direct manager decides first, then ${toCeo ? 'the CEO' : 'HR'}, who approves it as time off or, rarely, pays it in cash instead.';
  static const dayWorked = 'Day worked';
  static const dayWorkedHint = 'A rest day of your shift or an official holiday you worked: today or a day gone by.';
  static const hoursWorked = 'Hours worked';
  static const theWholeDay = 'The whole day';
  static const partOfTheDay = 'Part of the day';
  static const hoursWorkedThatDay = 'Hours worked that day';
  static const hoursPlaceholder = 'e.g. 4';
  static const hoursHint = 'The hours worked that day, e.g. 4 or 3.5.';
  static const earnsWholeDay = 'Earns a whole day off';
  static String earnsWholeDayFrom(String hours) => 'Earns a whole day off ($hours or more)';
  static String earnsHours(String hours, String? cap) => 'Earns $hours off${cap == null ? '' : ' (capped at $cap)'}';
  static String earnsNothing(String min) => 'Earns nothing: fewer than $min worked';
  static String rules(String min, String? sameHours, String full) =>
      '${['Under $min earn nothing', ?sameHours, '$full or more, a whole day'].join('; ')} (Compensatory Setup).';
  static String sameHoursOff(String min, String? cap) => 'from $min, the same hours off${cap == null ? '' : ', at most $cap'}';
  static const dayOff = 'Day off';
  static const dayForTheHoursOff = 'Day for the hours off';
  static String dayOffHint(String window, String? hours, double h) =>
      'A working day $window, tomorrow or later: not leave, work from home or an official holiday.${hours == null ? '' : ' The $hours off ${h == 1 ? 'is' : 'are'} counted as worked that day, with no deduction; you work the rest of it.'}';
  static const inTheSameMonth = 'in the same month as the day worked';
  static String withinDaysAfter(int n) => 'within $n ${n == 1 ? 'day' : 'days'} after the day worked';
  static const reason = 'Reason';
  static const reasonHint = 'Your direct manager and HR read it. Up to 500 characters.';
  static String noCheckIn(String day) => 'No check-in is kept on $day: HR will ask to confirm you worked that day.';

  // the checks (People's words, packages/shared compensatory.ts and the website's form)
  static const enterDayWorked = 'Enter the day you worked.';
  static const enterHours = 'Enter the hours worked, e.g. 4 or 3.5.';
  static const hoursAsNumber = 'Enter the hours worked as a number above 0, up to 24, e.g. 4 or 3.5.';
  static String fewerThanMin(String hours, String min) => 'You worked $hours: fewer than the $min that earn a compensation (Compensatory Setup).';
  static String workingDay(String day) => '$day is a working day of your shift, not a rest day or an official holiday: there is nothing to compensate.';
  static String claimedAlready(String day) => 'You have asked to compensate $day already.';
  static String notYet(String day) => '$day hasn’t come yet: a compensatory day is asked for a day already worked.';
  static const enterDayOff = 'Enter the day off you ask for.';
  static String dayOffHoliday(String day, String name) => '$day is an official holiday ($name): the day off must be a working day.';
  static String dayOffRest(String day) => '$day is a rest day of your shift: the day off must be a working day.';
  static String dayOffLeave(String type, String day, String status) => 'You have $type on $day ($status): it is a day off already.';
  static String dayOffOther(String what, String day) => 'You have $what on $day already.';
  static String sameMonth(String worked, String workedMonth, String off, String offMonth) =>
      'The day off must be in the same month as the day worked: $worked is in $workedMonth, $off in $offMonth.';
  static String withinDays(int n, String from, String to) => 'The day off must be within $n ${n == 1 ? 'day' : 'days'} after the day worked: from $from to $to.';
  static String goneBy(String day) => '$day has gone by: only HR records a day off that is past.';
  static String isToday(String day) => '$day is today: ask for a compensatory day a day before the day off at the latest.';
  static String ready(String days, bool toCeo) =>
      'Ready to send: a compensatory day$days, to your direct manager (without one, your lead), then ${toCeo ? 'the CEO' : 'HR'}.';
  static String readyDay(String worked, String off) => ' for $worked, with a day off on $off';
  static String readyHours(String hours, String worked, String off, String offDay) => ' for $hours worked on $worked, with $off off on $offDay';
  static String sentFor(String hours) => 'Request sent for $hours off.';

  // its page
  static const dayWorkedNote = 'A rest day of the shift or an official holiday. Nothing is paid for it when it is compensated with a day.';
  static const noCheckInNote = 'No check-in is kept on this day: HR confirms it was worked when deciding.';
  static String earnedWholeDay(String worked) => '$worked: earned a whole day off';
  static String earnedHours(String worked, String off, String? cap) => '$worked: earned $off off${cap == null ? '' : ' (capped at $cap)'}';
  static const partOfTheDayNote = 'Part of the day, by the Compensatory Setup.';
  static const hoursOffLabel = 'Hours off';
  static const dayOffAskedFor = 'Day off asked for';
  static const paidInCash = 'None: paid in cash instead';
  static String hoursOffOn(String hours) => '$hours off on ';
  static const hoursNote = 'Once approved, those hours count as worked that day, with no deduction: not leave, nothing comes off any balance.';
  static const dayNote = 'Once approved it counts as a full paid day, not leave: nothing comes off any balance.';
  static const none = 'None';
  static const hrDecision = 'HR’s decision';
  static const outcomes = {'day_off': 'Day off', 'cash': 'Cash instead'};
  static String cashAddedHours(String hoursPay, String rate) => 'An addition of $hoursPay at $rate× on the month’s payroll.';
  static String cashAddedDays(String daysPay) => 'An addition of $daysPay on the month’s payroll.';
  static String hoursPay(double h, String hours) => h == 1 ? '1 hour’s pay' : '$hours’ pay';
  static String daysPay(double n, String days) => n == 1 ? '1 day’s pay' : '$days days’ pay';
  static const reasonFact = 'Reason';
  static String withOd(String day) => 'With the official duty on $day. It is decided and cancelled with the official duty, never on its own.';
  static const recordedByHr = 'Recorded by HR';
  static const asked = 'Asked';
  static const others = 'Your other compensatory day requests are on My Requests.';
  static const stepCancelled = 'Cancelled';
  static const cancelTitle = 'Cancel the request';
  static const cancelExplain = 'While it is being decided you can cancel it, e.g. to ask for another day.';
  static const cancelButton = 'Cancel this request';
  static String cancelConfirm(String days) => 'Cancel your compensatory day request for $days? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Compensatory day cancelled. It stays on the list, cancelled; the day off is a working day again.';
}

/// Opens the sheet to ask for a compensatory day, from the tab's [context].
Future<void> showCompensatorySheet(BuildContext context) => openRequestSheet(
  context,
  title: CompensatoryWords.title,
  icon: kindIcons[RequestKind.compensatory]!,
  builder: (sheetContext, sent) => _CompensatoryForm(sent: sent),
);

String _number(double n) {
  final r = (n * 100).round() / 100;
  return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
}

/// The hours typed: 4, 3.5, 3,5 (a comma read as a point); null when they can't be read.
double? _hoursOf(String typed) {
  final t = typed.trim();
  if (!RegExp(r'^\d{1,2}(?:[.,]\d{1,2})?$').hasMatch(t)) return null;
  final h = double.parse(t.replaceAll(',', '.'));
  return h > 0 && h <= 24 ? h : null;
}

/// What the hours worked earn: null for nothing, 0 for a whole day, else the hours off.
double? _earnedHours(CompensatoryRules rules, double? hours) {
  if (hours == null || hours >= rules.fullDayHours) return 0;
  if (hours < rules.minHours) return null;
  return hours < rules.hoursCap ? hours : rules.hoursCap;
}

// ---------- the sheet ----------

class _CompensatoryForm extends ConsumerStatefulWidget {
  const _CompensatoryForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_CompensatoryForm> createState() => _CompensatoryFormState();
}

class _CompensatoryFormState extends ConsumerState<_CompensatoryForm> {
  final _hours = TextEditingController();
  final _reason = TextEditingController();
  bool _seeded = false;
  String? _worked;
  bool _part = false;
  String? _dayOff;
  bool _dayOffByHand = false;
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _hours.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool _restOrHoliday(CompensatoryForm f, String d) => !f.workingDays.contains(weekdayIndex(d)) || f.holidays.any((h) => h.date == d);

  bool _inWindow(CompensatoryForm f, String worked, String off) {
    final within = f.rules.offWithinDays;
    if (within == null) return off.substring(0, 7) == worked.substring(0, 7);
    final n = daysBetween(worked, off);
    return n >= 1 && n <= within;
  }

  bool _free(CompensatoryForm f, String d) =>
      !_restOrHoliday(f, d) && !f.leave.any((l) => l.date == d) && !f.other.any((o) => o.date == d);

  /// The smart default: the latest rest day or official holiday worked (a check-in kept), not yet claimed.
  void _seed(CompensatoryForm f) {
    _seeded = true;
    final from = f.from.isEmpty ? addDays(f.today, -62) : f.from;
    for (var d = f.today; d.compareTo(from) >= 0; d = addDays(d, -1)) {
      if (_restOrHoliday(f, d) && f.checkedIn.contains(d) && !f.claimed.contains(d)) {
        _worked = d;
        return;
      }
    }
  }

  /// The day off first offered: the next free working day from tomorrow inside the window after the day worked.
  String? _defaultDayOff(CompensatoryForm f, String worked) {
    var d = addDays(f.today, 1);
    if (d.compareTo(worked) <= 0) d = addDays(worked, 1);
    for (var i = 0; i < 62; i++, d = addDays(d, 1)) {
      if (!_inWindow(f, worked, d)) {
        if (d.substring(0, 7).compareTo(worked.substring(0, 7)) > 0 || (f.rules.offWithinDays != null && daysBetween(worked, d) > f.rules.offWithinDays!)) return null;
        continue;
      }
      if (_free(f, d)) return d;
    }
    return null;
  }

  List<String> _problems(CompensatoryForm f, double? hours) {
    if (f.refusal != null) return [f.refusal!];
    final out = <String>[];
    final w = _worked;
    if (w == null) out.add(CompensatoryWords.enterDayWorked);
    if (_part) {
      if (_hours.text.trim().isEmpty) {
        out.add(CompensatoryWords.enterHours);
      } else if (hours == null) {
        out.add(CompensatoryWords.hoursAsNumber);
      } else if (hours < f.rules.minHours) {
        out.add(CompensatoryWords.fewerThanMin(hoursShort(hours), hoursShort(f.rules.minHours)));
      }
    }
    if (w != null) {
      if (!_restOrHoliday(f, w)) out.add(CompensatoryWords.workingDay(dmy(w)));
      if (f.claimed.contains(w)) out.add(CompensatoryWords.claimedAlready(dmy(w)));
      if (w.compareTo(f.today) > 0) out.add(CompensatoryWords.notYet(dmy(w)));
    }
    final off = _dayOff;
    if (off == null) {
      out.add(CompensatoryWords.enterDayOff);
    } else {
      final holiday = f.holidays.where((h) => h.date == off).firstOrNull;
      final leave = f.leave.where((l) => l.date == off).firstOrNull;
      final other = f.other.where((o) => o.date == off).firstOrNull;
      if (holiday != null) {
        out.add(CompensatoryWords.dayOffHoliday(dmy(off), holiday.name));
      } else if (!f.workingDays.contains(weekdayIndex(off))) {
        out.add(CompensatoryWords.dayOffRest(dmy(off)));
      } else if (leave != null) {
        out.add(CompensatoryWords.dayOffLeave(leave.type, dmy(off), leave.status));
      } else if (other != null) {
        out.add(CompensatoryWords.dayOffOther(other.what, dmy(off)));
      }
      if (w != null && !_inWindow(f, w, off)) {
        final within = f.rules.offWithinDays;
        out.add(
          within == null
              ? CompensatoryWords.sameMonth(dmy(w), monthNameOf(w.substring(0, 7)), dmy(off), monthNameOf(off.substring(0, 7)))
              : CompensatoryWords.withinDays(within, dmy(addDays(w, 1)), dmy(addDays(w, within))),
        );
      }
      if (off.compareTo(f.today) < 0) out.add(CompensatoryWords.goneBy(dmy(off)));
      if (off == f.today) out.add(CompensatoryWords.isToday(dmy(off)));
    }
    return out;
  }

  String _ready(bool toCeo, double? hours, double? earned) {
    final w = dayWords(_worked!);
    final off = dayWords(_dayOff!);
    final days = _part && hours != null && earned != null && earned > 0
        ? CompensatoryWords.readyHours(hoursShort(hours), w, hoursShort(earned), off)
        : CompensatoryWords.readyDay(w, off);
    return CompensatoryWords.ready(days, toCeo);
  }

  Future<void> _send(double? hours) async {
    final reason = _reason.text.trim();
    final body = <String, Object?>{
      'dayWorked': _worked,
      'dayOff': _dayOff,
      if (_part && hours != null) 'hoursWorked': hours,
      if (reason.isNotEmpty) 'reason': reason,
    };
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.compensatory), body);
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.compensatory, json) as CompensatoryRequest;
      final sent = sentTextOf(made);
      widget.sent(made, made.hoursOff == null ? sent : sent.replaceFirst('Request sent.', CompensatoryWords.sentFor(hoursShort(made.hoursOff!))));
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _refusal = refusalOf(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(compensatoryFormProvider);
    return switch (form) {
      AsyncData(:final value) => _body(context, value),
      AsyncError() => SheetState.failed(onRetry: () => ref.invalidate(compensatoryFormProvider)),
      _ => const SheetState.loading(),
    };
  }

  Widget _body(BuildContext context, CompensatoryForm f) {
    if (f.refusal != null || !f.offered) return SheetState.refused(f.refusal ?? RequestsWords.formNotLoaded);
    if (!_seeded) _seed(f);
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final toCeo = ref.watch(confidentialProvider).value ?? false;
    final rules = f.rules;
    final hours = _part ? _hoursOf(_hours.text) : null;
    final earned = _part ? _earnedHours(rules, hours) : 0.0;
    if (_worked != null && _dayOff == null && !_dayOffByHand) _dayOff = _defaultDayOff(f, _worked!);
    final problems = _problems(f, hours);
    final byHours = _part && earned != null && earned > 0;
    final cap = rules.hoursCap < rules.fullDayHours ? _number(rules.hoursCap) : null;
    String earnsLine;
    if (!_part) {
      earnsLine = CompensatoryWords.earnsWholeDay;
    } else if (hours == null) {
      earnsLine = CompensatoryWords.hoursHint;
    } else if (hours >= rules.fullDayHours) {
      earnsLine = CompensatoryWords.earnsWholeDayFrom(hoursShort(rules.fullDayHours));
    } else if (earned == null) {
      earnsLine = CompensatoryWords.earnsNothing(hoursShort(rules.minHours));
    } else {
      earnsLine = CompensatoryWords.earnsHours(hoursShort(earned), hours > rules.hoursCap ? _number(rules.hoursCap) : null);
    }
    final window = rules.offWithinDays == null ? CompensatoryWords.inTheSameMonth : CompensatoryWords.withinDaysAfter(rules.offWithinDays!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(CompensatoryWords.intro(toCeo), style: text.bodyLarge?.copyWith(color: p.muted)),
        const SizedBox(height: 20),
        SheetField(
          label: CompensatoryWords.dayWorked,
          hint: CompensatoryWords.dayWorkedHint,
          child: PickDayField(
            label: CompensatoryWords.dayWorked,
            value: _worked,
            first: f.from.isEmpty ? null : f.from,
            last: f.today,
            onChanged: (d) => setState(() {
              _worked = d;
              if (!_dayOffByHand) _dayOff = null;
            }),
          ),
        ),
        SheetField(
          label: CompensatoryWords.hoursWorked,
          hint: _part ? null : earnsLine,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ChoicePills<bool>(
                values: const [false, true],
                labelOf: (part) => part ? CompensatoryWords.partOfTheDay : CompensatoryWords.theWholeDay,
                selected: _part,
                onChanged: (part) => setState(() {
                  _part = part;
                  if (!_dayOffByHand) _dayOff = null;
                }),
              ),
              if (_part) ...[
                const SizedBox(height: 12),
                SheetTextBox(
                  controller: _hours,
                  label: CompensatoryWords.hoursWorkedThatDay,
                  hint: CompensatoryWords.hoursPlaceholder,
                  keyboard: const TextInputType.numberWithOptions(decimal: true),
                  max: 5,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 6),
                Text(earnsLine, style: text.bodyMedium),
                const SizedBox(height: 4),
                Text(
                  CompensatoryWords.rules(
                    hoursShort(rules.minHours),
                    rules.minHours < rules.fullDayHours ? CompensatoryWords.sameHoursOff(hoursShort(rules.minHours), cap) : null,
                    hoursShort(rules.fullDayHours),
                  ),
                  style: text.bodySmall,
                ),
              ],
            ],
          ),
        ),
        SheetField(
          label: byHours ? CompensatoryWords.dayForTheHoursOff : CompensatoryWords.dayOff,
          hint: CompensatoryWords.dayOffHint(window, byHours ? hoursShort(earned) : null, earned ?? 0),
          child: PickDayField(
            label: byHours ? CompensatoryWords.dayForTheHoursOff : CompensatoryWords.dayOff,
            value: _dayOff,
            first: addDays(f.today, 1),
            last: f.to.isEmpty ? addDays(f.today, 120) : f.to,
            onChanged: (d) => setState(() {
              _dayOff = d;
              _dayOffByHand = true;
            }),
          ),
        ),
        SheetField(
          label: CompensatoryWords.reason,
          optional: true,
          hint: CompensatoryWords.reasonHint,
          child: SheetTextBox(controller: _reason, label: CompensatoryWords.reason, lines: 3, max: 500),
        ),
        if (_worked != null && !f.checkedIn.contains(_worked))
          RulesNote(icon: CupertinoIcons.exclamationmark_circle, lines: [CompensatoryWords.noCheckIn(dmy(_worked!))]),
        SendChecks(problems: problems, ready: problems.isEmpty ? _ready(toCeo, hours, earned) : null),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty ? () => _send(hours) : null),
        const SizedBox(height: Tokens.gapSmall),
      ],
    );
  }
}

// ---------- its page ----------

/// What a compensatory day's page shows.
RequestDetail compensatoryDetail(CompensatoryRequest r) {
  final cash = r.outcome == 'cash';
  final byHours = r.hoursOff != null;
  final worked = r.hoursWorked;
  final off = r.hoursOff;
  return basicDetail(
    r,
    title: CompensatoryWords.title,
    subline: '${r.recordedByHr ? CompensatoryWords.recordedByHr : CompensatoryWords.asked} ${dateTimeWords(r.createdAt)}',
    banner: r.od == null ? null : CompensatoryWords.withOd(dmy(r.od!.startDate)),
    facts: [
      (
        label: CompensatoryWords.dayWorked,
        value: dayWords(r.dayWorked),
        note: r.noCheckIn ? '${CompensatoryWords.dayWorkedNote}\n${CompensatoryWords.noCheckInNote}' : CompensatoryWords.dayWorkedNote,
      ),
      if (worked != null)
        (
          label: CompensatoryWords.hoursWorked,
          value: off == null
              ? CompensatoryWords.earnedWholeDay(hoursShort(worked))
              : CompensatoryWords.earnedHours(hoursShort(worked), hoursShort(off), off < worked ? _number(off) : null),
          note: CompensatoryWords.partOfTheDayNote,
        ),
      (
        label: cash ? (byHours ? CompensatoryWords.hoursOffLabel : CompensatoryWords.dayOff) : (byHours ? CompensatoryWords.dayForTheHoursOff : CompensatoryWords.dayOffAskedFor),
        value: cash
            ? CompensatoryWords.paidInCash
            : (r.dayOff == null ? CompensatoryWords.none : '${off != null ? CompensatoryWords.hoursOffOn(hoursShort(off)) : ''}${dayWords(r.dayOff!)}'),
        note: cash || r.dayOff == null ? null : (byHours ? CompensatoryWords.hoursNote : CompensatoryWords.dayNote),
      ),
      if (r.outcome != null)
        (
          label: CompensatoryWords.hrDecision,
          value: CompensatoryWords.outcomes[r.outcome] ?? r.outcome!,
          note: cash && r.status == 'approved'
              ? (off != null
                    ? CompensatoryWords.cashAddedHours(CompensatoryWords.hoursPay(off, hoursShort(off)), _number(r.cashDays))
                    : CompensatoryWords.cashAddedDays(CompensatoryWords.daysPay(r.cashDays, _number(r.cashDays))))
              : null,
        ),
      if (r.reason != null) (label: CompensatoryWords.reasonFact, value: r.reason!, note: null),
    ],
    stepText: (s) => s.kind == 'cancelled' ? CompensatoryWords.stepCancelled : stepTextOf(s, r.manager, r.confidential),
    notes: const [CompensatoryWords.others],
    actions: [
      if (r.canCancel && r.od == null)
        (
          title: CompensatoryWords.cancelTitle,
          explain: CompensatoryWords.cancelExplain,
          button: CompensatoryWords.cancelButton,
          confirm: CompensatoryWords.cancelConfirm(compensatoryDaysLine(r)),
          path: RequestPaths.action(RequestKind.compensatory, r.id, 'cancel'),
          done: CompensatoryWords.cancelled,
        ),
    ],
  );
}
