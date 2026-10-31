import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../format.dart' show clockOf;
import '../../../models/attendance_month.dart';
import '../../../models/requests.dart';
import '../../dashboard/dashboard_data.dart' show attendanceMonthProvider;
import '../../today/today_controller.dart' show todayProvider;
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';
import 'od.dart' show showOdSheet;

// An attendance correction (owner, 19 October 2026): a day that isn't right, a check-in or check-out forgotten, a time
// wrong, or work away from the office. The sheet starts on the latest day of the month with a check-in and no
// check-out (or no check-in), what is on record for it, the kind of mistake that day suggests and the shift's times;
// People checks the day, its month's payroll and the times again (packages/shared attendance-corrections.ts). Its page:
// the day, what was wrong, what was on record, the right times, every step, and Cancel while it is being decided. The
// Attendance tab asks for a correction from a day's row; this is the same request, started from Requests.

/// The correction's words (packages/shared attendance-corrections.ts; apps/web attendance/corrections).
abstract final class CorrectionWords {
  static const title = 'Attendance correction';
  static const intro = 'A day that isn’t right: you forgot to check in or out, or a time is wrong. Ask on the day or within 2 working days of it.';
  static String whoDecides(bool ceo) => 'Your direct manager (or lead) decides first, then ${ceo ? 'the CEO' : 'HR'}; approved, the day is corrected.';

  /// What was wrong, as the employee chooses it (owner, 31 October 2026: work away from the office is official duty now,
  /// "Remove it, point to OD").
  static const kindLabels = {'forgot_check_in': 'I forgot to check in', 'forgot_check_out': 'I forgot to check out', 'wrong_time': 'A time is wrong'};
  static const awayIsOd = 'Working away from the office (at a client, a shoot, an errand) is official duty: ask for official duty instead, or work from home for a day at home.';
  static const askOd = 'Ask for official duty';
  static String tooLate(String day) => 'It’s too late to ask to correct $day: ask within 2 working days of the day. HR can still correct it for you.';

  /// What was wrong, as the lists, HR and the manager say it.
  static const kindNames = {
    'forgot_check_in': 'Forgot to check in',
    'forgot_check_out': 'Forgot to check out',
    'wrong_time': 'Wrong time',
    'worked_remotely': 'Worked remotely or at a client',
  };
  static const sources = {'zoho': 'Zoho People', 'system': 'Checked in on the system', 'device': 'Attendance device', 'correction': 'Corrected'};
  static const leaveLike = {'rest': 'Rest day', 'holiday': 'Official holiday', 'leave': 'On leave', 'zoho_leave': 'Leave in Zoho only', 'no_check_in': 'No check-in'};
  static const absent = 'Absent';
  static const nothing = 'No check-in or check-out';
  static const noDay = 'No day on record';
  static const noCheckIn = 'no check-in';
  static const noCheckOut = 'no check-out';
  static String onRecordFor(String day) => 'On record for $day';
  static const checkedWhenSent = 'The day on record is checked when it is sent.';
  static const checkingDay = 'Checking what is on record…';
  static const day = 'Day';
  static const dayHint = 'Today, or a day up to 2 working days ago, in a month whose payroll isn’t approved yet.';
  static const whatWasWrong = 'What was wrong';
  static const cameIn = 'Came in at';
  static const leftAt = 'Left at';
  static const timesHint = 'Times on the day, e.g. 9:15 AM and 6:30 PM. A time left empty stays as on record.';
  static const why = 'Why';
  static const whyHint = 'E.g. I left for a client meeting and forgot to check out. Your manager and HR read it. Up to 500 characters.';
  static const whyPlaceholder = 'What happened that day';

  // the checks, in People's words (packages/shared correctionProblems)
  static String toCome(String day) => '$day is still to come: only a day gone by, or today, can be corrected.';
  static const reasonMissing = 'Write why the day needs correcting, e.g. I left for a client meeting and forgot to check out.';
  static String already(String day) => 'You asked to correct $day already: wait for it to be decided, or cancel it.';
  static String onLeave(String day) => 'You have approved leave on $day: there is no attendance to correct on a day of leave.';
  static const enterCameIn = 'Enter the time you came in.';
  static String checkedInAlready(String time, String day) => 'You checked in at $time on $day already: choose “A time is wrong” to change it.';
  static const enterLeft = 'Enter the time you left.';
  static String checkedOutAlready(String time, String day) => 'You checked out at $time on $day already: choose “A time is wrong” to change it.';
  static const enterEither = 'Enter the right time of the check-in, of the check-out, or both.';
  static String nothingToCorrect(String day) => 'There is no check-in or check-out on $day to correct: choose “I forgot to check in”.';
  static String notYet(String time) => 'Choose a time that has passed: $time today hasn’t come yet.';
  static String outAfterIn(String out, String inAt) => 'The check-out ($out) must be after the check-in ($inAt) on the same day.';
  static String ready(String what, String day, String hr) =>
      'Ready to send: ${what.toLowerCase()} on $day, to your direct manager (without one, your lead), then $hr.';
  static const correctedAtOnce = 'Day corrected, approved at once: its hours are counted again, and the month’s draft payroll takes it.';

  // its page
  static const pageTitle = 'Attendance correction';
  static const correctedByHr = 'Corrected by HR';
  static const sent = 'Sent';
  static const onRecordWhenAsked = 'On record when asked';
  static const rightTimes = 'The right times';
  static const asOnRecord = 'As on record';
  static const remoteNote = 'Counted as remote work, no longer flagged once approved';
  static String applied(String when) => 'The day was corrected $when';
  static const correctedDirectly = 'Corrected by HR directly: no decision needed';
  static const others = 'Your other corrections are on My Requests.';
  static const stepRecorded = 'Corrected by HR directly, approved at once';
  static const stepCancelled = 'Cancelled by the employee';
  static const cancelTitle = 'Cancel the correction';
  static const cancelExplain = 'While it is being decided you can cancel it, e.g. to ask again with other times. The day stays as it is.';
  static const cancelButton = 'Cancel this correction';
  static String cancelConfirm(String day) => 'Cancel your correction of $day? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Correction cancelled. It stays on the list, cancelled; the day is as it was.';
}

/// Whether a time is asked for, may be given, or isn't sent at all, by what was wrong (apps/web timesNeeded).
enum TimeNeed { required, optional, none }

({TimeNeed checkIn, TimeNeed checkOut}) timesNeeded(String kind, AttendanceDay? day) => switch (kind) {
  'forgot_check_in' => (checkIn: TimeNeed.required, checkOut: TimeNeed.optional),
  'forgot_check_out' => (checkIn: TimeNeed.none, checkOut: TimeNeed.required),
  _ => (checkIn: TimeNeed.optional, checkOut: TimeNeed.optional),
};

bool _openAt(AttendanceDay d) => d.raw['openAt'] is String;

/// A day with a check-in and no check-out after it (or none at all) gone by: the likely forgotten one.
bool _missingOut(AttendanceDay d) => d.checkIn != null && (d.checkOut == null || _openAt(d));
bool _missingIn(AttendanceDay d) => d.checkIn == null && d.checkOut == null && d.status == 'no_check_in';

/// The month's days with a correction being decided.
Set<String> openCorrectionDays(AttendanceMonth m) {
  final list = m.raw['corrections'];
  return {
    if (list is List)
      for (final c in list)
        if (c is Map && (c['status'] == 'with_manager' || c['status'] == 'with_hr') && c['date'] is String) c['date'] as String,
  };
}

/// The day to suggest: the latest day gone by this month with a check-in and no check-out, or no check-in, no
/// correction asked yet, and still open to ask about (from [askFrom]); none, today.
String suggestedCorrectionDay(AttendanceMonth? m, String today, {String? askFrom}) {
  if (m == null) return today;
  final open = openCorrectionDays(m);
  final past = [
    for (final d in m.days)
      if (d.date.compareTo(today) < 0 &&
          (askFrom == null || d.date.compareTo(askFrom) >= 0) &&
          !open.contains(d.date) &&
          (_missingOut(d) || _missingIn(d)))
        d,
  ]..sort((a, b) => b.date.compareTo(a.date));
  return past.isEmpty ? today : past.first.date;
}

/// The earliest day they can still ask to correct (owner, 31 October 2026: "locked after 2 working days"), as their
/// month says it; null from an API from before it.
String? askFromOf(AttendanceMonth? m) {
  final ask = m?.raw['ask'];
  return ask is Map && ask['from'] is String ? ask['from'] as String : null;
}

/// What was likely wrong on a day, from what is on record.
String suggestedCorrectionKind(AttendanceDay? d, String today) {
  if (d == null || (d.checkIn == null && d.checkOut == null)) return 'forgot_check_in';
  if (d.date.compareTo(today) < 0 && _missingOut(d)) return 'forgot_check_out';
  return 'wrong_time';
}

/// The day as it is on record: "9:02 AM – no check-out", "Absent", "Rest day".
String onRecordText({required String status, required String? checkIn, required String? checkOut}) {
  if (checkIn == null && checkOut == null) return status == 'absent' ? CorrectionWords.absent : (CorrectionWords.leaveLike[status] ?? CorrectionWords.nothing);
  return '${checkIn != null ? timeOfMoment(checkIn) : CorrectionWords.noCheckIn} – ${checkOut != null ? timeOfMoment(checkOut) : CorrectionWords.noCheckOut}';
}

int? _minutes(String? hhmm) {
  final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(hhmm ?? '');
  return m == null ? null : int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

/// The checks the sheet can make before People does (packages/shared correctionProblems): the day, the reason, the
/// times the kind needs, what is on record. [day] is null when the day isn't known (its month not read).
List<String> correctionProblems({
  required String date,
  required String today,
  required String kind,
  required AttendanceDay? day,
  required bool dayKnown,
  required String? checkIn,
  required String? checkOut,
  required String reason,
  String? locked,
  Set<String> openDays = const {},
  String? now,
  bool nightShift = false,
  String? askFrom,
}) {
  final when = dayWords(date);
  if (date.compareTo(today) > 0) return [CorrectionWords.toCome(dmy(date))];
  // asked too long after the day (owner, 31 October 2026: "locked after 2 working days")
  if (askFrom != null && date.compareTo(askFrom) < 0) return [CorrectionWords.tooLate(dmy(date))];
  final out = <String>[];
  if (reason.trim().isEmpty) out.add(CorrectionWords.reasonMissing);
  if (locked != null) out.add(locked);
  if (dayKnown && openDays.contains(date)) out.add(CorrectionWords.already(when));
  if (dayKnown && day?.status == 'leave') out.add(CorrectionWords.onLeave(when));
  switch (kind) {
    case 'forgot_check_in':
      if (checkIn == null) out.add(CorrectionWords.enterCameIn);
      if (dayKnown && day?.checkIn != null) out.add(CorrectionWords.checkedInAlready(timeOfMoment(day!.checkIn!), when));
    case 'forgot_check_out':
      if (checkOut == null) out.add(CorrectionWords.enterLeft);
      if (dayKnown && day?.checkOut != null && !_openAt(day!)) out.add(CorrectionWords.checkedOutAlready(timeOfMoment(day.checkOut!), when));
    default:
      if (checkIn == null && checkOut == null) out.add(CorrectionWords.enterEither);
      if (dayKnown && day != null && day.checkIn == null && day.checkOut == null) out.add(CorrectionWords.nothingToCorrect(when));
  }
  final nowMinutes = _minutes(now);
  if (date == today && nowMinutes != null) {
    for (final t in [?checkIn, ?checkOut]) {
      if (_minutes(t)! > nowMinutes) out.add(CorrectionWords.notYet(time12(t)));
    }
  }
  final i = _minutes(checkIn);
  final o = _minutes(checkOut);
  if (i != null && o != null && o <= i && !nightShift) out.add(CorrectionWords.outAfterIn(time12(checkOut!), time12(checkIn!)));
  return out;
}

/// Opens the sheet to ask for a correction, from the tab's [context].
Future<void> showCorrectionSheet(BuildContext context) {
  final ceo = ProviderScope.containerOf(context, listen: false).read(confidentialProvider).value;
  return openRequestSheet(
    context,
    title: CorrectionWords.title,
    icon: kindIcons[RequestKind.correction]!,
    intro: ceo == null ? CorrectionWords.intro : '${CorrectionWords.intro} ${CorrectionWords.whoDecides(ceo)}',
    builder: (sheetContext, sent) => _CorrectionForm(sent: sent),
  );
}

class _CorrectionForm extends ConsumerStatefulWidget {
  const _CorrectionForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_CorrectionForm> createState() => _CorrectionFormState();
}

class _CorrectionFormState extends ConsumerState<_CorrectionForm> {
  final _today = todayIso();
  String? _date;
  String? _kind;

  /// A time set by hand (or cleared): the shift's no longer offered for it.
  bool _inSet = false;
  bool _outSet = false;
  String? _checkIn;
  String? _checkOut;
  final _reason = TextEditingController();
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _set({required bool inTime, required String? value}) {
    if (inTime) {
      _inSet = true;
      _checkIn = value;
    } else {
      _outSet = true;
      _checkOut = value;
    }
  }

  void _resetTimes() {
    _inSet = _outSet = false;
    _checkIn = _checkOut = null;
  }

  Future<void> _send(Map<String, Object?> body) async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.correction), body);
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.correction, json);
      widget.sent(made, made.status == 'approved' ? CorrectionWords.correctedAtOnce : sentTextOf(made));
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
    final current = ref.watch(attendanceMonthProvider(thisMonth));
    if (current.hasError) {
      final e = current.error;
      if (e is ApiException && (e.status == 403 || e.status == 404)) return SheetState.refused(e.message);
      return SheetState.failed(onRetry: () => ref.invalidate(attendanceMonthProvider(thisMonth)));
    }
    final firstMonth = current.value;
    if (firstMonth == null) return const SheetState.loading();

    final askFrom = askFromOf(firstMonth);
    final date = _date ?? suggestedCorrectionDay(firstMonth, _today, askFrom: askFrom);
    final monthOf = ref.watch(attendanceMonthProvider(date.substring(0, 7)));
    final m = monthOf.value;
    final dayKnown = m != null;
    AttendanceDay? day;
    for (final d in m?.days ?? const <AttendanceDay>[]) {
      if (d.date == date) day = d;
    }
    final kind = _kind ?? suggestedCorrectionKind(day, _today);
    final needs = timesNeeded(kind, day);
    final shift = ref.watch(todayProvider).value;
    final checkIn = needs.checkIn == TimeNeed.none ? null : (_inSet ? _checkIn : (needs.checkIn == TimeNeed.required ? shift?.shiftStart : null));
    final checkOut = needs.checkOut == TimeNeed.none ? null : (_outSet ? _checkOut : (needs.checkOut == TimeNeed.required ? shift?.shiftEnd : null));
    final correctable = m?.raw['correctable'];
    final locked = correctable is Map && correctable['allowed'] == false ? '${correctable['reason'] ?? ''}'.trim() : null;
    final ceo = ref.watch(confidentialProvider).value ?? false;
    final night = (_minutes(shift?.shiftEnd) ?? 1) < (_minutes(shift?.shiftStart) ?? 0);
    final problems = correctionProblems(
      date: date,
      today: _today,
      kind: kind,
      day: day,
      dayKnown: dayKnown,
      checkIn: checkIn,
      checkOut: checkOut,
      reason: _reason.text,
      locked: locked == null || locked.isEmpty ? null : locked,
      openDays: m == null ? const {} : openCorrectionDays(m),
      now: clockOf(DateTime.now()),
      nightShift: night,
      askFrom: askFrom,
    );
    final record = switch ((monthOf.isLoading, dayKnown)) {
      (true, false) => CorrectionWords.checkingDay,
      (false, false) => CorrectionWords.checkedWhenSent,
      _ => day == null ? CorrectionWords.noDay : onRecordText(status: day.status, checkIn: day.checkIn, checkOut: day.checkOut),
    };
    final source = day == null ? null : CorrectionWords.sources['${day.raw['source'] ?? 'zoho'}'];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: CorrectionWords.day,
          hint: CorrectionWords.dayHint,
          child: PickDayField(
            label: CorrectionWords.day,
            value: date,
            first: askFrom,
            last: _today,
            onChanged: (d) => setState(() {
              _date = d;
              _kind = null;
              _resetTimes();
            }),
          ),
        ),
        RulesNote(icon: CupertinoIcons.calendar, lines: [CorrectionWords.onRecordFor(dayWords(date)), record, ?source]),
        SheetField(
          label: CorrectionWords.whatWasWrong,
          child: ChoicePills<String>(
            values: CorrectionWords.kindLabels.keys.toList(),
            labelOf: (k) => CorrectionWords.kindLabels[k]!,
            selected: kind,
            onChanged: (k) => setState(() {
              _kind = k;
              _resetTimes();
            }),
          ),
        ),
        // work away from the office is official duty (owner, 31 October 2026: "Remove it, point to OD")
        Text(CorrectionWords.awayIsOd, style: Theme.of(context).textTheme.bodySmall),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            onPressed: () {
              final host = Navigator.of(context, rootNavigator: true).context;
              Navigator.of(context).pop();
              showOdSheet(host);
            },
            child: const Text(CorrectionWords.askOd),
          ),
        ),
        const SizedBox(height: 8),
        if (needs.checkIn != TimeNeed.none)
          SheetField(
            label: CorrectionWords.cameIn,
            optional: needs.checkIn == TimeNeed.optional,
            child: PickTimeField(
              label: CorrectionWords.cameIn,
              value: checkIn,
              onChanged: (t) => setState(() => _set(inTime: true, value: t)),
              onClear: () => setState(() => _set(inTime: true, value: null)),
            ),
          ),
        SheetField(
          label: CorrectionWords.leftAt,
          optional: needs.checkOut == TimeNeed.optional,
          hint: CorrectionWords.timesHint,
          child: PickTimeField(
            label: CorrectionWords.leftAt,
            value: checkOut,
            onChanged: (t) => setState(() => _set(inTime: false, value: t)),
            onClear: () => setState(() => _set(inTime: false, value: null)),
          ),
        ),
        SheetField(
          label: CorrectionWords.why,
          hint: CorrectionWords.whyHint,
          child: SheetTextBox(controller: _reason, label: CorrectionWords.why, hint: CorrectionWords.whyPlaceholder, lines: 3, max: 500, onChanged: (_) => setState(() {})),
        ),
        SendChecks(problems: problems, ready: CorrectionWords.ready(CorrectionWords.kindNames[kind]!, dayWords(date), RequestsWords.hrStage(ceo))),
        PeopleRefusal(messages: _refusal),
        SheetButtons(
          busy: _busy,
          onSend: problems.isEmpty
              ? () => _send({'date': date, 'kind': kind, 'reason': _reason.text.trim(), 'checkIn': ?checkIn, 'checkOut': ?checkOut})
              : null,
        ),
      ],
    );
  }
}

/// "9:05 AM – 6:30 PM", "In at 9:05 AM", "Out at 6:30 PM", "As on record".
String rightTimesText(CorrectionRequest r) {
  final i = r.checkIn == null ? null : timeOfMoment(r.checkIn!);
  final o = r.checkOut == null ? null : timeOfMoment(r.checkOut!);
  final t = i != null && o != null ? '$i – $o' : (i != null ? 'in at $i' : (o != null ? 'out at $o' : null));
  return t == null ? CorrectionWords.asOnRecord : '${t[0].toUpperCase()}${t.substring(1)}';
}

/// A correction's page.
RequestDetail correctionDetail(CorrectionRequest r) {
  final before = r.dayBefore;
  final d = basicDetail(
    r,
    title: CorrectionWords.pageTitle,
    subline: '${r.recordedByHr ? CorrectionWords.correctedByHr : CorrectionWords.sent} ${dateTimeWords(r.createdAt)}',
    facts: [
      (label: CorrectionWords.day, value: dayWords(r.date), note: null),
      (label: CorrectionWords.whatWasWrong, value: CorrectionWords.kindNames[r.correctionKind] ?? r.correctionKind, note: null),
      (
        label: CorrectionWords.onRecordWhenAsked,
        value: before == null ? CorrectionWords.noDay : onRecordText(status: before.status, checkIn: before.checkIn, checkOut: before.checkOut),
        note: before == null ? null : CorrectionWords.sources[before.source],
      ),
      (label: CorrectionWords.rightTimes, value: rightTimesText(r), note: r.correctionKind == 'worked_remotely' ? CorrectionWords.remoteNote : null),
      (label: CorrectionWords.why, value: r.reason, note: null),
    ],
    stepText: (s) => switch (s.kind) {
      'recorded_by_hr' => CorrectionWords.stepRecorded,
      'cancelled' => CorrectionWords.stepCancelled,
      _ => stepTextOf(s, r.manager, r.confidential),
    },
    notes: [if (r.appliedAt != null) CorrectionWords.applied(dateTimeWords(r.appliedAt!)), CorrectionWords.others],
    actions: [
      if (r.canCancel)
        (
          title: CorrectionWords.cancelTitle,
          explain: CorrectionWords.cancelExplain,
          button: CorrectionWords.cancelButton,
          confirm: CorrectionWords.cancelConfirm(dayWords(r.date)),
          path: RequestPaths.action(RequestKind.correction, r.id, 'cancel'),
          done: CorrectionWords.cancelled,
        ),
    ],
  );
  if (!r.recordedByHr) return d;
  // HR corrected it directly: no decision needed, in the correction's words
  return RequestDetail(
    title: d.title,
    status: d.status,
    state: d.state,
    subline: d.subline,
    facts: [for (final f in d.facts) f.value == RequestsWords.recordedNoDecision ? (label: f.label, value: CorrectionWords.correctedDirectly, note: f.note) : f],
    steps: d.steps,
    notes: d.notes,
    actions: d.actions,
  );
}
