import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../format.dart' show monthNameOf;
import '../../../models/request_forms.dart';
import '../../../models/requests.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"): a
// working day from home instead of the office, asked a day before at the latest, within Leave Setup's days a month and
// days apart. The sheet starts from the allowance (GET /api/me/wfh/allowance) on the next day possible; People checks
// the day again (packages/shared wfh.ts). Its page: the day, its month, every step, and Cancel while it is being decided.

/// Working from home's words (apps/web attendance/wfh/wfh.ts, wfh-forms.tsx, wfh-request.tsx; packages/shared wfh.ts).
abstract final class WfhWords {
  static const title = 'Work from home';
  static const intro = 'A working day from home instead of the office, asked a day before at the latest.';
  static String whoDecides(bool ceo) => 'Your direct manager decides first, then ${ceo ? 'the CEO' : 'HR'}.';
  static const turnedOff = 'Working from home is turned off: Leave Setup gives no work from home days a month. Ask HR.';
  static const turnedOffLine = 'Working from home is turned off in Leave Setup.';
  static const notYet = 'Not available yet: the server does not have working from home yet.';
  static String allowance(int used, int perMonth, String? next) =>
      '$used of $perMonth this month · ${next == null ? 'no day possible in the coming months' : 'next possible from $next'}';
  static String rules(int perMonth, int gap) =>
      'At most $perMonth ${perMonth == 1 ? 'day' : 'days'} a month, any two at least $gap ${gap == 1 ? 'day' : 'days'} apart, asked a day before at the latest, as Leave Setup gives it.';
  static const day = 'Day';
  static const dayHint = 'Tomorrow or later: a working day you would be at the office, not an official holiday or a day of leave.';
  static const reason = 'Reason';
  static const reasonHint = 'Your direct manager and HR read it. Up to 500 characters.';
  static const reasonPlaceholder = 'E.g. a delivery at home in the morning';

  // the checks, in People's words (packages/shared wfh.ts)
  static String goneBy(String day) => '$day has gone by: ask for a work from home day a day before it at the latest.';
  static String isToday(String day) => '$day is today: ask for a work from home day a day before it at the latest.';
  static String already(String day) => 'You have a work from home day on $day already.';
  static String monthFull(String month, int n, int inMonth) =>
      '$month\'s $n ${n == 1 ? 'day' : 'days'} of working from home are already asked for: $inMonth of $n.';
  static String gap(int g, String day, int k, String other) =>
      'Two work from home days must be at least $g ${g == 1 ? 'day' : 'days'} apart: $day is $k ${k == 1 ? 'day' : 'days'} from your day on $other.';
  static String ready(String day, String hr) => 'Ready to send: working from home on $day, to your direct manager (without one, your lead), then $hr.';
  static const recordedApproved = 'Work from home day recorded, approved at once. That day you check in from home, without the office network.';

  // its page
  static const pageTitle = 'Work from home';
  static const dayNote = 'A working day from home, not leave: checked in from home as any day';
  static const itsMonth = 'Its month';
  static String taken(int n) => '$n taken';
  static const takenNote = 'Approved and waiting, this one counted';
  static const imported = 'Imported from Zoho People';
  static const recordedByHr = 'Recorded by HR';
  static const asked = 'Asked by the employee';
  static const others = 'Your other work from home requests are on My Requests.';
  static const stepImported = 'Imported from Zoho People, approved';
  static const stepRecorded = 'Recorded by HR, approved at once';
  static const stepCancelled = 'Cancelled';
  static const cancelTitle = 'Cancel the request';
  static const cancelExplain = 'While it is being decided you can cancel it, e.g. to ask for another day.';
  static const cancelButton = 'Cancel this request';
  static String cancelConfirm(String day) => 'Cancel your work from home request for $day? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Work from home cancelled. It stays on the list, cancelled; the day is free again.';
}

/// "0 of 2 this month · next possible from 02/11/2026", or "in November 2026" for a day in another month.
String wfhAllowanceLine(WfhAllowance a, [String? date]) {
  if (!(a.daysPerMonth > 0)) return WfhWords.turnedOffLine;
  final month = date == null ? a.month : date.substring(0, 7);
  final used = a.taken.where((t) => t.date.startsWith(month)).length;
  final line = WfhWords.allowance(used, a.daysPerMonth, a.nextPossible == null ? null : dmy(a.nextPossible!));
  return month == a.month || date == null ? line : line.replaceFirst('this month', 'in ${monthNameOf(month)}');
}

/// The checks the sheet can make before People does (packages/shared wfhNoticeProblem, wfhLimitProblems): asked a day
/// before, within the days a month and days apart. Working days, holidays and leave are People's to say.
List<String> wfhProblems(WfhAllowance a, String date) {
  final today = a.today.isEmpty ? todayIso() : a.today;
  final shown = dmy(date);
  if (date.compareTo(today) < 0) return [WfhWords.goneBy(shown)];
  if (date == today) return [WfhWords.isToday(shown)];
  final others = [
    for (final t in a.taken)
      if (t.date != date) t.date,
  ];
  if (a.taken.any((t) => t.date == date)) return [WfhWords.already(shown)];
  final out = <String>[];
  final month = date.substring(0, 7);
  final inMonth = others.where((d) => d.startsWith(month)).length;
  if (inMonth >= a.daysPerMonth) out.add(WfhWords.monthFull(monthNameOf(month), a.daysPerMonth, inMonth));
  String? nearest;
  var apart = 1 << 30;
  for (final d in others) {
    final k = daysBetween(d, date).abs();
    if (k < apart) (nearest, apart) = (d, k);
  }
  if (nearest != null && apart < a.minGapDays) out.add(WfhWords.gap(a.minGapDays, shown, apart, dmy(nearest)));
  return out;
}

/// Opens the sheet to ask to work from home, from the tab's [context].
Future<void> showWfhSheet(BuildContext context) {
  final ceo = ProviderScope.containerOf(context, listen: false).read(confidentialProvider).value;
  return openRequestSheet(
    context,
    title: WfhWords.title,
    icon: kindIcons[RequestKind.wfh]!,
    intro: ceo == null ? WfhWords.intro : '${WfhWords.intro} ${WfhWords.whoDecides(ceo)}',
    builder: (sheetContext, sent) => _WfhForm(sent: sent),
  );
}

class _WfhForm extends ConsumerStatefulWidget {
  const _WfhForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_WfhForm> createState() => _WfhFormState();
}

class _WfhFormState extends ConsumerState<_WfhForm> {
  String? _date;
  final _reason = TextEditingController();
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _send(String date) async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    final reason = _reason.text.trim();
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.wfh), {'date': date, if (reason.isNotEmpty) 'reason': reason});
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.wfh, json);
      widget.sent(made, made.status == 'approved' ? WfhWords.recordedApproved : sentTextOf(made));
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
    final allowance = ref.watch(wfhAllowanceProvider);
    if (allowance.hasError) {
      final e = allowance.error;
      if (e is ApiException && e.status == 404) return const SheetState.refused(WfhWords.notYet);
      if (e is ApiException && (e.status == 403 || e.status == 409 || e.status == 400)) return SheetState.refused(e.message);
      return SheetState.failed(onRetry: () => ref.invalidate(wfhAllowanceProvider));
    }
    final a = allowance.value;
    if (a == null) return const SheetState.loading();
    if (a.refusal != null) return SheetState.refused(a.refusal!);
    if (!(a.daysPerMonth > 0)) return const SheetState.refused(WfhWords.turnedOff);

    final today = a.today.isEmpty ? todayIso() : a.today;
    final date = _date ?? a.nextPossible ?? addDays(today, 1);
    final ceo = ref.watch(confidentialProvider).value ?? false;
    final problems = wfhProblems(a, date);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RulesNote(icon: CupertinoIcons.house, lines: [wfhAllowanceLine(a, date), WfhWords.rules(a.daysPerMonth, a.minGapDays)]),
        SheetField(
          label: WfhWords.day,
          hint: WfhWords.dayHint,
          child: PickDayField(label: WfhWords.day, value: date, first: addDays(today, 1), last: addDays(today, 180), onChanged: (d) => setState(() => _date = d)),
        ),
        SheetField(
          label: WfhWords.reason,
          optional: true,
          hint: WfhWords.reasonHint,
          child: SheetTextBox(controller: _reason, label: WfhWords.reason, hint: WfhWords.reasonPlaceholder, lines: 3, max: 500),
        ),
        SendChecks(problems: problems, ready: WfhWords.ready(dayWords(date), RequestsWords.hrStage(ceo))),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty ? () => _send(date) : null),
      ],
    );
  }
}

/// Where a work from home day came from: imported, recorded by HR, or asked.
String _source(WfhRequest r) => r.source == 'zoho' ? WfhWords.imported : (r.recordedByHr ? WfhWords.recordedByHr : WfhWords.asked);

/// A work from home day's page.
RequestDetail wfhDetail(WfhRequest r) {
  final imported = r.source == 'zoho';
  return basicDetail(
    r,
    title: WfhWords.pageTitle,
    subline: '${_source(r)} ${dateTimeWords(r.createdAt)}',
    progress: imported && r.status == 'approved' ? WfhWords.imported : null,
    facts: [
      (label: WfhWords.day, value: dayWords(r.date), note: WfhWords.dayNote),
      if (r.monthUsed != null) (label: WfhWords.itsMonth, value: WfhWords.taken(r.monthUsed!), note: WfhWords.takenNote),
      if (r.reason != null) (label: WfhWords.reason, value: r.reason!, note: null),
    ],
    stepText: (s) => switch (s.kind) {
      'imported' => WfhWords.stepImported,
      'recorded_by_hr' => WfhWords.stepRecorded,
      'cancelled' => WfhWords.stepCancelled,
      _ => stepTextOf(s, r.manager, r.confidential),
    },
    notes: const [WfhWords.others],
    actions: [
      if (r.canCancel)
        (
          title: WfhWords.cancelTitle,
          explain: WfhWords.cancelExplain,
          button: WfhWords.cancelButton,
          confirm: WfhWords.cancelConfirm(dayWords(r.date)),
          path: RequestPaths.action(RequestKind.wfh, r.id, 'cancel'),
          done: WfhWords.cancelled,
        ),
    ],
  );
}
