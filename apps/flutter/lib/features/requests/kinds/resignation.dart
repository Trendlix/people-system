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
// preferred last working day and the box saying they understand; HR records it (the CEO for a C-level person), and it
// may be withdrawn until then (POST /api/me/resignation, JSON). Offered only when People's form says so (an employment
// under the labour law, the rule on, none waiting already). The letter (owner, 31 October 2026: "on the resignation, the
// letter is auto generated, viewed by the employee but uploaded by the HR"): nothing is attached; People prepares it from
// the request, opened from its page in the phone's PDF viewer to print and sign, and HR uploads the signed copy, which
// opens there too. Words from apps/web resignations (forms.tsx, resignation.ts, [id]/page.tsx) and packages/shared
// resignation-request.ts.

/// The resignation's words, in one place (ready for Arabic).
abstract final class ResignationWords {
  static const title = 'Resignation';

  // the form
  static const reason = 'Reason';
  static const preferred = 'Preferred last working day';

  /// The notice the rule gives, and the day it would end if sent today; null without a rule.
  static String? noticeHint(String? notice, String? lastDay) =>
      notice == null ? null : 'Notice: $notice${lastDay == null ? '' : ', ending ${dmy(lastDay)} if sent today'}.';

  static const confirmation = 'I understand a resignation counts once certified at the labour office (Decree 187/2025).';
  static const send = 'Send resignation request';

  // the checks (packages/shared resignation-request.ts resignationProblems)
  static const enterReason = 'Enter your reason for resigning.';
  static const reasonTooLong = 'The reason can be at most 300 characters.';
  static const notBeforeToday = 'Your preferred last working day must be today or later.';
  static const tooFar = 'Your preferred last working day is more than a year away.';
  static const tick = 'Tick the box to say you understand a resignation counts once certified at the labour office.';
  static const notAvailable = 'Not available yet: the server does not have resignation requests yet.';

  // once sent
  static String sent(bool toCeo) => toCeo ? 'Sent to the CEO.' : 'Sent to HR.';

  // its page
  static const pageTitle = 'Resignation request';
  static const confirmedFact = 'Confirmed';
  static const noticeReceived = 'Notice received on';
  static const ruleLastDay = 'Last working day by the rule';
  static String ruleLastDayValue(String day, String notice) => '$day ($notice from the notice day)';
  static const preferredFact = 'Preferred last working day';
  static const noneGiven = 'None given';
  static const letterFact = 'Signed copy';
  static const notUploaded = 'Not uploaded yet';
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
  static const withdrawConfirm = 'Withdraw your resignation request?';
  static const withdrawButton = 'Withdraw my request';
  static const withdrawDone = 'Request withdrawn.';

  // the letter (owner, 31 October 2026), as the website's request page says it
  static const letterTitle = 'Resignation letter';
  static const viewLetter = 'View letter';
  static const viewSigned = 'View signed copy';
  static const letterFileName = 'Resignation letter.pdf';
  static const noTemplate = 'HR hasn’t set up the resignation letter template yet.';
  static const noViewer = 'No app on this phone opens the letter: install a PDF viewer.';
}

/// Opens the sheet to send a resignation request, from the tab's [context].
Future<void> showResignationSheet(BuildContext context) => openRequestSheet(
  context,
  title: ResignationWords.title,
  icon: kindIcons[RequestKind.resignation]!,
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
    ];
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.resignation), {'reason': _reason.text.trim(), 'preferredLastDay': _preferred ?? '', 'confirmed': _confirmed});
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.resignation, json);
      widget.sent(made, ResignationWords.sent(made.confidential));
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
    final problems = _problems(today);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: ResignationWords.reason,
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
        // no letter to attach: People prepares it (owner, 31 October 2026)
        SwitchRow(label: ResignationWords.confirmation, value: _confirmed, onChanged: (v) => setState(() => _confirmed = v)),
        SendChecks(problems: problems),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, sendLabel: ResignationWords.send, onSend: problems.isEmpty ? _send : null),
      ],
    );
  }
}

// ---------- its page ----------

/// What a resignation request's page shows: its notice, the days, the reason, what became of it, the letter to view
/// (owner, 31 October 2026) with its signed copy, and Withdraw until HR records it.
RequestDetail resignationDetail(ResignationRequest r) {
  final returned = r.status == 'returned' || r.returnedAt != null;
  final id = Uri.encodeComponent(r.id);
  final signed = r.letter;
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
      (label: ResignationWords.letterFact, value: signed?.fileName ?? ResignationWords.notUploaded, note: null),
      if (returned)
        (
          label: ResignationWords.returned,
          value: [if (r.returnedAt != null) dateTimeWords(r.returnedAt!), r.returnedReason ?? ResignationWords.returnedNoReason].join(' · '),
          note: null,
        ),
      if (r.withdrawnAt != null) (label: ResignationWords.withdrawn, value: dateTimeWords(r.withdrawnAt!), note: null),
      if (r.recordedAt != null) (label: ResignationWords.recorded, value: dateTimeWords(r.recordedAt!), note: null),
      (label: ResignationWords.confirmedFact, value: ResignationWords.confirmation, note: null),
    ],
    // People's letter once HR has set its template up, and the signed copy HR uploaded; none for an API from before it
    opens: r.preparedLetter == null
        ? null
        : (
            title: ResignationWords.letterTitle,
            files: [
              if (r.preparedLetter == 'ready')
                (button: ResignationWords.viewLetter, path: '/api/resignation-requests/$id/generated-letter', fileName: ResignationWords.letterFileName, mimeType: 'application/pdf'),
              if (signed != null) (button: ResignationWords.viewSigned, path: '/api/resignation-requests/$id/letter', fileName: signed.fileName, mimeType: signed.mimeType),
            ],
            notes: [if (r.preparedLetter != 'ready') ResignationWords.noTemplate],
            noViewer: ResignationWords.noViewer,
          ),
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
          button: ResignationWords.withdrawButton,
          confirm: ResignationWords.withdrawConfirm,
          path: RequestPaths.action(RequestKind.resignation, r.id, 'withdraw'),
          done: ResignationWords.withdrawDone,
        ),
    ],
  );
}
