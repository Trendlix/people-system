import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../models/requests.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// A resignation request (Decree 187/2025: a resignation counts once certified at the labour office): the reason, the
// preferred last working day, a photo of the signed letter, and the box saying they understand; HR records it (the CEO
// for a C-level person), and it may be withdrawn until then (multipart POST /api/me/resignation, the letter in "letter").
// Offered only when People's form says so (an employment under the labour law, the rule on, none waiting already).
// Words from apps/web resignations (forms.tsx, resignation.ts) and packages/shared resignation-request.ts.

/// The resignation's words, in one place (ready for Arabic).
abstract final class ResignationWords {
  static const title = 'Resignation';
  static const intro =
      'Tell HR you wish to resign. The day you send this is the day the notice is received. HR records it, the labour office certifies it, and the CEO approves it. You can withdraw the request until HR records it.';

  // the form
  static const reason = 'Reason';
  static String reasonHint(bool toCeo) => 'Short. ${toCeo ? 'The CEO reads it.' : 'HR reads it.'} Up to 300 characters.';
  static const preferred = 'Preferred last working day';
  static String noticeHint(String? notice, String? lastDay) {
    if (notice == null) return 'Leave it empty to leave it to the notice.';
    return 'The notice is $notice by the resignation rule${lastDay == null ? '' : ': sent today, it would end on ${dmy(lastDay)}'}. A shorter time is for HR to agree.';
  }

  static const letter = 'Signed letter';
  static const letterHint = 'A photo of the signed letter, up to 4 MB.';
  static const confirmation = 'I understand a resignation counts once certified at the labour office (Decree 187/2025).';
  static const send = 'Send resignation request';

  // the checks (packages/shared resignation-request.ts resignationProblems)
  static const enterReason = 'Enter your reason for resigning.';
  static const reasonTooLong = 'The reason can be at most 300 characters.';
  static const notBeforeToday = 'Your preferred last working day must be today or later.';
  static const tooFar = 'Your preferred last working day is more than a year away. Choose a nearer day, or leave it empty.';
  static const tick = 'Tick the box to say you understand a resignation counts once certified at the labour office.';
  static const letterTooBig = 'The letter must be 4 MB or smaller.';
  static String ready(bool toCeo) => 'Ready to send: your resignation, its notice received today, to ${toCeo ? 'the CEO' : 'HR'}.';
  static const notAvailable = 'Not available yet: the server does not have resignation requests yet.';

  // once sent
  static const sent = 'Your resignation request was sent. HR has been told; you can withdraw it until it is recorded.';

  // its page
  static const pageTitle = 'Resignation request';
  static const noticeReceived = 'Notice received on';
  static const ruleLastDay = 'Last working day by the rule';
  static String ruleLastDayValue(String day, String notice) => '$day ($notice from the notice day)';
  static const preferredFact = 'Preferred last working day';
  static const noneGiven = 'None given';
  static const letterFact = 'Signed letter';
  static const noneAttached = 'None attached';
  static const returned = 'Returned';
  static const returnedNoReason = 'with a reason for the employee';
  static const withdrawn = 'Withdrawn';
  static const recorded = 'Recorded';

  // its steps (from what People keeps of it)
  static const stepSent = 'Sent to HR, the notice received';
  static const stepReturned = 'Returned by HR';
  static const stepWithdrawn = 'Withdrawn by the employee';
  static const stepRecorded = 'Recorded by HR as the ending of the employment';

  // withdrawing it
  static const withdrawTitle = 'Withdraw the request';
  static const withdrawExplain = 'You can withdraw it until HR records it. It is kept, marked withdrawn.';
  static const withdrawConfirm = 'Withdraw your resignation request? It is kept, marked withdrawn; you can send another.';
  static const withdrawButton = 'Withdraw my request';
  static const withdrawDone = 'The request was withdrawn. It is kept, marked withdrawn.';
}

/// Opens the sheet to send a resignation request, from the tab's [context].
Future<void> showResignationSheet(BuildContext context) => openRequestSheet(
  context,
  title: ResignationWords.title,
  icon: kindIcons[RequestKind.resignation]!,
  intro: ResignationWords.intro,
  builder: (sheetContext, sent) => _ResignationForm(sent: sent),
);

class _ResignationForm extends ConsumerStatefulWidget {
  const _ResignationForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_ResignationForm> createState() => _ResignationFormState();
}

class _ResignationFormState extends ConsumerState<_ResignationForm> {
  final _reason = TextEditingController();
  String? _preferred;
  List<PickedPhoto> _letter = const [];
  bool _confirmed = false;
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  List<String> _problems(String today) {
    final reason = _reason.text.trim();
    return [
      if (reason.isEmpty) ResignationWords.enterReason,
      if (reason.length > 300) ResignationWords.reasonTooLong,
      if (_preferred != null && _preferred!.compareTo(today) < 0) ResignationWords.notBeforeToday,
      if (_preferred != null && _preferred!.compareTo(addDays(today, 366)) > 0) ResignationWords.tooFar,
      if (!_confirmed) ResignationWords.tick,
      if (_letter.any((p) => p.bytes.length > 4 * 1024 * 1024)) ResignationWords.letterTooBig,
    ];
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendForm(
        ref,
        RequestPaths.create(RequestKind.resignation),
        {'reason': _reason.text.trim(), 'preferredLastDay': _preferred ?? '', 'confirmed': _confirmed ? 'true' : 'false'},
        [for (final p in _letter) ('letter', p)],
      );
      if (!mounted) return;
      requestsChanged(ref);
      widget.sent(requestOf(RequestKind.resignation, json), ResignationWords.sent);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _refusal = refusalOf(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = ref.watch(myResignationProvider);
    final form = mine.value?.form;
    if (form == null) {
      if (mine.hasError) {
        if (isUnavailable(mine.error)) return const SheetState.refused(ResignationWords.notAvailable);
        return SheetState.failed(onRetry: () => ref.invalidate(myResignationProvider));
      }
      return const SheetState.loading();
    }
    if (!form.offered) return SheetState.refused(form.refusal ?? ResignationWords.notAvailable);
    final today = form.today.isEmpty ? todayIso() : form.today;
    final toCeo = ref.watch(confidentialProvider).value ?? false;
    final problems = _problems(today);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: ResignationWords.reason,
          hint: ResignationWords.reasonHint(toCeo),
          child: SheetTextBox(controller: _reason, label: ResignationWords.reason, lines: 3, max: 300, onChanged: (_) => setState(() {})),
        ),
        SheetField(
          label: ResignationWords.preferred,
          optional: true,
          hint: ResignationWords.noticeHint(form.notice, form.lastDayIfToday),
          child: PickDayField(
            label: ResignationWords.preferred,
            value: _preferred,
            first: today,
            last: addDays(today, 366),
            onChanged: (d) => setState(() => _preferred = d),
            onClear: () => setState(() => _preferred = null),
          ),
        ),
        SheetField(
          label: ResignationWords.letter,
          optional: true,
          hint: ResignationWords.letterHint,
          child: PhotosField(photos: _letter, max: 1, onChanged: (p) => setState(() => _letter = p)),
        ),
        SwitchRow(label: ResignationWords.confirmation, value: _confirmed, onChanged: (v) => setState(() => _confirmed = v)),
        SendChecks(problems: problems, ready: ResignationWords.ready(toCeo)),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, sendLabel: ResignationWords.send, onSend: problems.isEmpty ? _send : null),
      ],
    );
  }
}

// ---------- its page ----------

/// What a resignation request's page shows: its notice, the days, the reason and the letter, what became of it, and
/// Withdraw until HR records it.
RequestDetail resignationDetail(ResignationRequest r) {
  final returned = r.status == 'returned' || r.returnedAt != null;
  return RequestDetail(
    title: ResignationWords.pageTitle,
    status: statusLabelOf(r),
    state: stateOf(r),
    subline: RequestsWords.sentOn(dateTimeWords(r.createdAt)),
    facts: [
      (label: ResignationWords.noticeReceived, value: dmy(r.sentOn), note: null),
      (label: ResignationWords.ruleLastDay, value: ResignationWords.ruleLastDayValue(dmy(r.ruleLastDay), r.notice), note: null),
      (label: ResignationWords.preferredFact, value: r.preferredLastDay == null ? ResignationWords.noneGiven : dmy(r.preferredLastDay!), note: null),
      if (r.reason != null) (label: ResignationWords.reason, value: r.reason!, note: null),
      (label: ResignationWords.letterFact, value: r.letter?.fileName ?? ResignationWords.noneAttached, note: null),
      if (returned)
        (
          label: ResignationWords.returned,
          value: [if (r.returnedAt != null) dateTimeWords(r.returnedAt!), r.returnedReason ?? ResignationWords.returnedNoReason].join(' · '),
          note: null,
        ),
      if (r.withdrawnAt != null) (label: ResignationWords.withdrawn, value: dateTimeWords(r.withdrawnAt!), note: null),
      if (r.recordedAt != null) (label: ResignationWords.recorded, value: dateTimeWords(r.recordedAt!), note: null),
    ],
    notes: const [ResignationWords.confirmation],
    steps: [
      (text: ResignationWords.stepSent, comment: null, who: [if (r.employeeName.isNotEmpty) r.employeeName, dateTimeWords(r.createdAt)].join(' · '), tone: null),
      if (r.returnedAt != null) (text: ResignationWords.stepReturned, comment: r.returnedReason, who: dateTimeWords(r.returnedAt!), tone: RequestState.closed),
      if (r.withdrawnAt != null) (text: ResignationWords.stepWithdrawn, comment: null, who: dateTimeWords(r.withdrawnAt!), tone: null),
      if (r.recordedAt != null) (text: ResignationWords.stepRecorded, comment: null, who: dateTimeWords(r.recordedAt!), tone: RequestState.approved),
    ],
    actions: [
      if (r.canWithdraw)
        (
          title: ResignationWords.withdrawTitle,
          explain: ResignationWords.withdrawExplain,
          button: ResignationWords.withdrawButton,
          confirm: ResignationWords.withdrawConfirm,
          path: RequestPaths.action(RequestKind.resignation, r.id, 'withdraw'),
          done: ResignationWords.withdrawDone,
        ),
    ],
  );
}
