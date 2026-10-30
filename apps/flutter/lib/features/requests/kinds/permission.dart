import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../format.dart' show monthNameOf;
import '../../../models/request_forms.dart';
import '../../../models/requests.dart';
import '../../dashboard/dashboard_data.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// Permission (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like
// leave"): a few hours away from a working day, in half hours, the times if known. The sheet starts from the month's
// hours (GET /api/me/permissions/allowance), today and the most the day allows; People checks everything again
// (packages/shared permissions.ts permissionRequestProblems). Its page: the day, the hours, the times, every step, and
// Cancel while it is being decided or its day is still to come.

/// Permission's words (apps/web leave/permissions.ts, permission-forms.tsx, permission-request.tsx).
abstract final class PermissionWords {
  static const title = 'New permission';
  static const intro = 'A few hours away from a working day, in half-hour blocks: to come late or leave early.';
  static String whoDecides(bool ceo) => 'Your direct manager decides first, then ${ceo ? 'the CEO' : 'HR'}.';
  static const off = 'Permission is turned off: Leave Setup gives no permission hours a month. Ask HR.';
  static const turnedOff = 'Permission is turned off in Leave Setup: there are no permission hours a month to ask for.';
  static const thisMonth = 'This month';
  static String monthOff(String when) => '$when: permission is turned off in Leave Setup.';
  static String monthText(String when, String approved, String? waiting, String left, String perMonth) =>
      '$when: $approved approved${waiting == null ? '' : ', $waiting waiting'}, $left left of $perMonth';
  static String rules(String perDay, String perMonth) => 'Your permission: at most $perDay a day and $perMonth a month, as Leave Setup gives it.';
  static String dayUsed(String clock, String day) => '$clock already asked for on $day.';
  static const day = 'Day';
  static const dayHint = 'A working day of your shift, not an official holiday or a day of leave.';
  static const hours = 'Hours';
  static String hoursHint(String perDay) => 'In half hours, at most $perDay a day.';
  static const from = 'From';
  static const to = 'To';
  static const timesHint = 'Choose one: the other follows from the hours, e.g. leaving at 5:00 PM for 2 hours is from 5:00 PM.';
  static String asChosen(String times) => 'As chosen: $times.';
  static const reason = 'Reason';
  static const reasonHint = 'Your direct manager and HR read it. Up to 500 characters.';
  static const reasonPlaceholder = 'E.g. a doctor’s appointment';

  // the checks, in People's words (packages/shared permissions.ts)
  static String checking(String month) => 'Checking the permission hours of $month…';
  static String perDayMax(String max, String hours) => 'Permission is at most $max a day; this is $hours.';
  static String dayLeft(String left, String max, String day, String used) => 'Only $left left of the $max a day on $day: $used already asked for.';
  static String dayFull(String max, String day) => 'The $max a day on $day are already asked for.';
  static String monthLeft(String left, String month, String perMonth) => 'Only $left left of $month\'s $perMonth of permission.';
  static String monthFull(String month, String perMonth) => '$month\'s $perMonth of permission are already asked for.';
  static const endAfterStart = 'The time it ends must be after the time it starts, on the same day.';
  static String spanNot(String from, String to, String span, String hours) => 'From $from to $to is $span, not $hours: change the hours or the times.';
  static String pastMidnight(String hours, String from) => '$hours from $from run to midnight or past it: choose an earlier time.';
  static String beforeMidnight(String hours, String to) => '$hours up to $to start before midnight: choose a later time.';
  static String ready(String hours, String day, String? times, String hr) =>
      'Ready to send: $hours on $day${times == null ? '' : ' ($times)'}, to your direct manager (without one, your lead), then $hr.';
  static const recordedApproved = 'Permission recorded, approved at once. Its hours count as worked in the month’s payroll.';

  // its page
  static const pageTitle = 'Permission';
  static const hoursNote = 'Counted as worked once approved';
  static const times = 'Times';
  static const notGiven = 'Not given';
  static const leftOfMonth = 'Left of its month';
  static const leftNote = 'Of the month\'s permission hours, with those approved and waiting taken';
  static const others = 'Your other permission requests are on My Requests.';
  static const stepCancelled = 'Cancelled, the hours given back';
  static const cancelTitle = 'Cancel the permission';
  static const cancelApproved = 'Approved and its day still to come: you can still cancel it, and its hours go back to the month’s allowance.';
  static const cancelOpen = 'While it is being decided you can cancel it, e.g. to ask again for another day or other hours.';
  static const cancelButton = 'Cancel this permission';
  static String cancelConfirm(String day, String hours) => 'Cancel your permission on $day ($hours)? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Permission cancelled. Its hours are back in the month’s allowance; it stays on the list, cancelled.';
}

/// "This month: 1:30 approved, 0:30 waiting, 2:00 left of 4:00" (the website's permissionMonthText).
String permissionMonthText(PermissionMonth m, String thisMonth) {
  final when = m.month == thisMonth || m.month.isEmpty ? PermissionWords.thisMonth : monthNameOf(m.month);
  if (!(m.hoursPerMonth > 0)) return PermissionWords.monthOff(when);
  return PermissionWords.monthText(when, clockHours(m.approved), m.pending > 0 ? clockHours(m.pending) : null, clockHours(m.left), clockHours(m.hoursPerMonth));
}

/// The sheet's first default: as many hours as the day and the month allow, up to 2, in half hours (at least half an hour).
double defaultPermissionHours(PermissionMonth m) {
  var most = [2.0, m.maxHoursPerDay, m.left].reduce((a, b) => a < b ? a : b);
  most = (most * 2).floor() / 2;
  return most < 0.5 ? 0.5 : most;
}

int? _minutes(String? hhmm) {
  final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(hhmm ?? '');
  return m == null ? null : int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

String _hhmm(int minutes) => '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';

/// The times as they come out: both given, or the one given and the other from the hours ("5:00 PM – 7:00 PM").
String? permissionTimesShown(String? from, String? to, double hours) {
  final f = _minutes(from);
  final t = _minutes(to);
  final span = (hours * 60).round();
  if (f != null && t != null) return '${time12(from!)} – ${time12(to!)}';
  if (f != null && f + span < 24 * 60) return '${time12(from!)} – ${time12(_hhmm(f + span))}';
  if (t != null && t - span >= 0) return '${time12(_hhmm(t - span))} – ${time12(to!)}';
  return null;
}

/// The checks the sheet can make before People does (packages/shared permissionRequestProblems): the day's and the
/// month's hours, and the times against the hours. Rest days, holidays and leave are People's to say.
List<String> permissionProblems({required String date, required double hours, required PermissionMonth m, String? from, String? to}) {
  final out = <String>[];
  final dayText = dayWords(date);
  if (!(m.hoursPerMonth > 0)) return [PermissionWords.turnedOff];
  if (hours > m.maxHoursPerDay) {
    out.add(PermissionWords.perDayMax(hoursText(m.maxHoursPerDay), hoursText(hours)));
  } else {
    final used = m.usedOn(date);
    final dayLeft = m.maxHoursPerDay - used;
    if (dayLeft <= 0) {
      out.add(PermissionWords.dayFull(hoursText(m.maxHoursPerDay), dayText));
    } else if (hours > dayLeft) {
      out.add(PermissionWords.dayLeft(hoursText(dayLeft), hoursText(m.maxHoursPerDay), dayText, hoursText(used)));
    }
  }
  final month = monthNameOf(m.month);
  if (m.left <= 0) {
    out.add(PermissionWords.monthFull(month, hoursText(m.hoursPerMonth)));
  } else if (hours > m.left) {
    out.add(PermissionWords.monthLeft(hoursText(m.left), month, hoursText(m.hoursPerMonth)));
  }
  final f = _minutes(from);
  final t = _minutes(to);
  final span = (hours * 60).round();
  if (f != null && t != null) {
    if (t <= f) {
      out.add(PermissionWords.endAfterStart);
    } else if (t - f != span) {
      out.add(PermissionWords.spanNot(time12(from!), time12(to!), hoursText((t - f) / 60), hoursText(hours)));
    }
  } else if (f != null && f + span >= 24 * 60) {
    out.add(PermissionWords.pastMidnight(hoursText(hours), time12(from!)));
  } else if (t != null && t - span < 0) {
    out.add(PermissionWords.beforeMidnight(hoursText(hours), time12(to!)));
  }
  return out;
}

/// Opens the sheet to ask for permission, from the tab's [context].
Future<void> showPermissionSheet(BuildContext context) {
  final ceo = ProviderScope.containerOf(context, listen: false).read(confidentialProvider).value;
  return openRequestSheet(
    context,
    title: PermissionWords.title,
    icon: kindIcons[RequestKind.permission]!,
    intro: ceo == null ? PermissionWords.intro : '${PermissionWords.intro} ${PermissionWords.whoDecides(ceo)}',
    builder: (sheetContext, sent) => _PermissionForm(sent: sent),
  );
}

class _PermissionForm extends ConsumerStatefulWidget {
  const _PermissionForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_PermissionForm> createState() => _PermissionFormState();
}

class _PermissionFormState extends ConsumerState<_PermissionForm> {
  final _today = todayIso();
  String? _picked;

  // the day as shown, worked out in build: as picked, else today, or the next working day when today isn't one
  String _date = todayIso();
  double? _hours;
  String? _from;
  String? _to;
  final _reason = TextEditingController();
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _send(double hours) async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    final reason = _reason.text.trim();
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.permission), {
        'date': _date,
        'hours': hours,
        'fromTime': ?_from,
        'toTime': ?_to,
        if (reason.isNotEmpty) 'reason': reason,
      });
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.permission, json);
      widget.sent(made, made.status == 'approved' ? PermissionWords.recordedApproved : sentTextOf(made));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _refusal = refusalOf(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final thisMonth = _today.substring(0, 7);
    final gate = ref.watch(permissionMonthProvider(thisMonth));
    if (gate.hasError) {
      final e = gate.error;
      if (e is ApiException && (e.status == 403 || e.status == 409 || e.status == 400)) return SheetState.refused(e.message);
      return SheetState.failed(onRetry: () => ref.invalidate(permissionMonthProvider(thisMonth)));
    }
    final first = gate.value;
    if (first == null) return const SheetState.loading();
    if (!(first.hoursPerMonth > 0)) return const SheetState.refused(PermissionWords.off);

    final profile = ref.watch(ownProfileProvider).value;
    final holidays = {...?ref.watch(holidaysProvider(int.parse(_today.substring(0, 4)))).value?.map((h) => h.date)};
    _date = _picked ?? (profile == null ? _today : nextWorkingDay(_today, profile.workingDays, holidays));
    final month = _date.substring(0, 7);
    final chosen = ref.watch(permissionMonthProvider(month));
    final m = chosen.value;
    final hours = _hours ?? defaultPermissionHours(m ?? first);
    final ceo = ref.watch(confidentialProvider).value ?? false;
    final perDay = (m ?? first).maxHoursPerDay;
    final choices = [for (var h = 0.5; h <= perDay + 0.001; h += 0.5) h];
    final problems = m == null
        ? [if (chosen.isLoading) PermissionWords.checking(monthNameOf(month)) else ...refusalOf(chosen.error ?? '')]
        : permissionProblems(date: _date, hours: hours, m: m, from: _from, to: _to);
    final shownTimes = permissionTimesShown(_from, _to, hours);
    final rules = m ?? first;
    final used = rules.usedOn(_date);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RulesNote(
          icon: CupertinoIcons.clock,
          lines: [
            permissionMonthText(rules, thisMonth),
            PermissionWords.rules(hoursText(rules.maxHoursPerDay), hoursText(rules.hoursPerMonth)),
            if (used > 0) PermissionWords.dayUsed(clockHours(used), dayWords(_date)),
          ],
        ),
        SheetField(
          label: PermissionWords.day,
          hint: PermissionWords.dayHint,
          child: PickDayField(label: PermissionWords.day, value: _date, onChanged: (d) => setState(() => _picked = d)),
        ),
        SheetField(
          label: PermissionWords.hours,
          hint: PermissionWords.hoursHint(hoursText(perDay)),
          child: ChoicePills<double>(values: choices, labelOf: hoursText, selected: hours, onChanged: (h) => setState(() => _hours = h)),
        ),
        SheetField(
          label: PermissionWords.from,
          optional: true,
          child: PickTimeField(
            label: PermissionWords.from,
            value: _from,
            onChanged: (t) => setState(() => _from = t),
            onClear: () => setState(() => _from = null),
          ),
        ),
        SheetField(
          label: PermissionWords.to,
          optional: true,
          hint: '${PermissionWords.timesHint}${shownTimes == null ? '' : ' ${PermissionWords.asChosen(shownTimes)}'}',
          child: PickTimeField(
            label: PermissionWords.to,
            value: _to,
            onChanged: (t) => setState(() => _to = t),
            onClear: () => setState(() => _to = null),
          ),
        ),
        SheetField(
          label: PermissionWords.reason,
          optional: true,
          hint: PermissionWords.reasonHint,
          child: SheetTextBox(controller: _reason, label: PermissionWords.reason, hint: PermissionWords.reasonPlaceholder, lines: 3, max: 500),
        ),
        SendChecks(
          problems: problems,
          ready: PermissionWords.ready(hoursText(hours), dayWords(_date), shownTimes, RequestsWords.hrStage(ceo)),
        ),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty ? () => _send(hours) : null),
      ],
    );
  }
}

/// A permission's page.
RequestDetail permissionDetail(PermissionRequest r) {
  final times = timesText(r.fromTime, r.toTime);
  return basicDetail(
    r,
    title: PermissionWords.pageTitle,
    facts: [
      (label: PermissionWords.day, value: dayWords(r.date), note: null),
      (label: PermissionWords.hours, value: hoursText(r.hours), note: PermissionWords.hoursNote),
      (label: PermissionWords.times, value: times ?? PermissionWords.notGiven, note: null),
      if (r.monthLeft != null) (label: PermissionWords.leftOfMonth, value: clockHours(r.monthLeft!), note: PermissionWords.leftNote),
      if (r.reason != null) (label: PermissionWords.reason, value: r.reason!, note: null),
    ],
    stepText: (s) => s.kind == 'cancelled' ? PermissionWords.stepCancelled : stepTextOf(s, r.manager, r.confidential),
    notes: const [PermissionWords.others],
    actions: [
      if (r.canCancel)
        (
          title: PermissionWords.cancelTitle,
          explain: r.status == 'approved' ? PermissionWords.cancelApproved : PermissionWords.cancelOpen,
          button: PermissionWords.cancelButton,
          confirm: PermissionWords.cancelConfirm(dayWords(r.date), hoursText(r.hours)),
          path: RequestPaths.action(RequestKind.permission, r.id, 'cancel'),
          done: PermissionWords.cancelled,
        ),
    ],
  );
}
