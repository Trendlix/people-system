import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../format.dart';
import '../../../models/request_forms.dart';
import '../../../models/requests.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// A reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"): the type of expense HR set up for them, the date and the amount, what it was for, and a photo of each
// receipt (multipart, field "receipts", as POST /api/me/reimbursements takes it). The type's caps and what is left of
// them show as it is chosen; People checks them all again. Its page: the claim, its receipts, every step with its
// amount, and Cancel while it is being decided. Words from apps/web reimbursements (claim.ts, list.ts, claim-forms.tsx).

/// The reimbursement's words, in one place (ready for Arabic).
abstract final class ClaimWords {
  static const title = 'New reimbursement';
  static String intro(bool toCeo) =>
      'Claim back an expense you paid for the company, with its receipts. Your direct manager decides first, then '
      '${toCeo ? 'the CEO, for HR’s and Finance’s stages' : 'HR, then Finance'}; once approved, it is paid with the next payroll, untaxed.';

  // the form
  static const type = 'Type of expense';
  static const typeHint = 'The types HR set up that you may claim, each with its own conditions.';
  static const chooseType = 'Choose a type';
  static const date = 'Date of the expense';
  static String dateHint(int? within) => 'The day on the receipt; not after today.${within == null ? '' : ' This type is claimed within $within days of it.'}';
  static const amount = 'Amount spent (EGP)';
  static const amountHint = 'As on the receipt, e.g. 250 or 250.50.';
  static const what = 'What it was for';
  static const whatHint = 'E.g. a taxi to the client’s office for the launch meeting. Your direct manager, HR and Finance read it. Up to 500 characters.';
  static const receipts = 'Receipts';
  static const receiptsRequired = 'Receipts (required for this type)';
  static const receiptsHint = 'A clear photo of each receipt or invoice; up to 5.';

  // the type's panel
  static const receiptNeeded = 'Receipt needed';
  static const noReceiptNeeded = 'No receipt needed';
  static const noCap = 'No cap';
  static String upTo(List<String> caps) => 'Up to EGP ${caps.join(', ')}';
  static String capClaim(String n) => '$n a claim';
  static String capMonth(String n) => '$n a month';
  static String capYear(String n) => '$n a year';
  static String within(int days) => 'Within ${dayCount(days)} of the expense';
  static String aClaim(String most) => 'A claim: $most, at most each time';
  static String monthLeft(String month, String left, String cap, String used) => '$month: $left left, of $cap a month; $used claimed';
  static String yearLeft(String year, String left, String cap, String used) => '$year: $left left, of $cap a year; $used claimed';
  static const anyAmount = 'No cap: any amount spent can be claimed.';
  static String canClaimUpTo(String most) => 'You can claim up to $most now.';
  static String checking(String month) => 'Checking what is left for $month…';

  // the checks (packages/shared reimbursements.ts reimbursementProblems, apps/web claim.ts claimProblems)
  static const chooseTypeProblem = 'Choose the type of expense.';
  static const enterAmount = 'Enter the amount spent, more than 0, e.g. 250 or 250.50.';
  static const afterToday = 'The expense’s date can’t be after today.';
  static String tooLate(int within, int age) => 'This type must be claimed within ${dayCount(within)} of the expense; this one was ${dayCount(age)} ago.';
  static const attachReceipt = 'Attach the receipt: this type needs one.';
  static String atMostAtOnce(double cap) => 'At most EGP ${cap.toStringAsFixed(2)} can be claimed at once for this type.';
  static String onlyLeftMonth(double left, double cap) => 'Only EGP ${left.toStringAsFixed(2)} is left of this type’s EGP ${cap.toStringAsFixed(2)} for the expense’s month.';
  static String onlyLeftYear(double left, double cap) => 'Only EGP ${left.toStringAsFixed(2)} is left of this type’s EGP ${cap.toStringAsFixed(2)} for the expense’s year.';
  static const describe = 'Describe the expense: what it was for.';
  static const receiptTooBig = 'Each receipt must be 10 MB or smaller.';
  static String ready(String amount, String type, int receipts, bool toCeo) =>
      'Ready to send: $amount for $type${receipts == 0 ? '' : (receipts == 1 ? ', with one receipt' : ', with $receipts receipts')}, to your direct manager '
      '(without one, your lead), then ${toCeo ? 'the CEO' : 'HR, then Finance'}.';

  // when it can't be asked
  static const noTypes = 'There is no type of expense you can claim now. HR sets them up, each for the people it is for: ask HR if you expected one.';
  static const notAvailable = 'Not available yet: the server does not have reimbursements yet.';
  static const cannotClaim = 'You can’t claim a reimbursement.';

  // once sent
  static String sent(String status, Approver? manager, bool toCeo) {
    final stages = toCeo ? 'the CEO, for HR’s and Finance’s stages' : 'HR, then Finance';
    final first = status == 'with_manager' ? '${yourApprover(manager)}, then $stages' : stages;
    return 'Claim sent. It goes to $first; each step shows on the claim. Once approved, it is paid with the next payroll.';
  }

  // its page
  static String claimTitle(String type) => '$type claim';
  static const typeFact = 'Type';
  static const dateFact = 'Date of the expense';
  static const amountClaimed = 'Amount claimed';
  static const amountApproved = 'Amount approved';
  static const approvedSoFar = 'Approved so far';
  static const lessThanClaimed = 'Less than claimed: see the comment in the log.';
  static const paidWith = 'Paid with';
  static String payrollUntaxed(String month) => 'The $month payroll, untaxed';
  static const receiptsTitle = 'Receipts';
  static const noReceipt = 'No receipt attached.';
  static const noReceiptNeeded2 = 'No receipt attached; this type needs none.';
  static String receiptN(int n) => 'Receipt $n';

  // where it stands (apps/web reimbursements/list.ts progressText)
  static String withApprover(Approver? m) => RequestsWords.withApprover(approverPhrase(m), m?.name);
  static String waitingForHr(bool ceo) => ceo ? 'Waiting for the CEO, at HR’s stage' : 'Waiting for HR';
  static String waitingForFinance(bool ceo) => ceo ? 'Waiting for the CEO, at Finance’s stage' : 'Waiting for Finance';
  static String rejectedAtStage(String stage) => 'Rejected at $stage’s stage';
  static String rejectedBy(String who) => 'Rejected by $who';
  static const rejected = 'Rejected';
  static const cancelledByEmployee = 'Cancelled by the employee';
  static const approved = 'Approved';
  static String paidWithPayroll(String month) => 'Approved: paid with the $month payroll';
  static String additionCancelled(String month) => 'Approved: its addition to the $month payroll was cancelled';
  static String toBePaid(String month) => 'Approved: to be paid with the $month payroll';

  // each step (apps/web reimbursements/list.ts stepText)
  static const claimedByEmployee = 'Claimed by the employee';
  static const noManager = 'No direct manager or lead: sent straight to HR';
  static String lowerAtStage(String stage) => 'A lower amount approved at $stage’s stage';
  static String approvedAtStage(String stage) => 'Approved at $stage’s stage';
  static String whoRejected(String who) => '$who rejected it';
  static String whoApprovedLower(String who) => '$who approved a lower amount';
  static String whoApproved(String who) => '$who approved it';
  static String addedToPayroll(String? month) => month == null ? 'Added to the payroll' : 'Added to the $month payroll';
  static String untaxed(String amount) => '$amount, untaxed';

  // cancelling it
  static const cancelTitle = 'Cancel the claim';
  static const cancelExplain = 'While it is being decided you can cancel it, e.g. to send it again with another amount or receipt.';
  static String cancelConfirm(String type, String amount) => 'Cancel your $type claim of $amount? It stays on your list, cancelled; send a new claim to ask again.';
  static const cancelButton = 'Cancel this claim';
  static const cancelled = 'Claim cancelled. It stays on your list, cancelled.';

  static String dayCount(int n) => n == 1 ? '1 day' : '$n days';
}

/// Opens the sheet to claim a reimbursement, from the tab's [context].
Future<void> showClaimSheet(BuildContext context) {
  final toCeo = ProviderScope.containerOf(context, listen: false).read(confidentialProvider).value ?? false;
  return openRequestSheet(
    context,
    title: ClaimWords.title,
    icon: kindIcons[RequestKind.claim]!,
    intro: ClaimWords.intro(toCeo),
    builder: (sheetContext, sent) => _ClaimForm(sent: sent),
  );
}

/// The amount typed: commas and spaces dropped, Arabic digits read, more than 0 with at most 2 decimals; null otherwise.
double? amountOf(String typed) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  var s = typed.trim().replaceAll(RegExp(r'[,\s،]'), '').replaceAll('٫', '.');
  s = s.split('').map((c) => arabic.contains(c) ? '${arabic.indexOf(c)}' : c).join();
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(s)) return null;
  final n = double.tryParse(s);
  return n == null || n <= 0 || n > 9999999999.99 ? null : n;
}

class _ClaimForm extends ConsumerStatefulWidget {
  const _ClaimForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_ClaimForm> createState() => _ClaimFormState();
}

class _ClaimFormState extends ConsumerState<_ClaimForm> {
  String _date = todayIso();
  String? _typeId;
  final _amount = TextEditingController();
  final _what = TextEditingController();
  List<PickedPhoto> _photos = const [];

  /// The types last read (kept while another month's are read).
  List<ReimbursementType>? _types;
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _amount.dispose();
    _what.dispose();
    super.dispose();
  }

  String _money(double n) => egp(n).substring(4);

  List<String> _panel(ReimbursementType t) {
    final caps = [
      if (t.capPerClaim != null) ClaimWords.capClaim(_money(t.capPerClaim!)),
      if (t.capPerMonth != null) ClaimWords.capMonth(_money(t.capPerMonth!)),
      if (t.capPerYear != null) ClaimWords.capYear(_money(t.capPerYear!)),
    ];
    final rules = [
      t.receiptRequired ? ClaimWords.receiptNeeded : ClaimWords.noReceiptNeeded,
      caps.isEmpty ? ClaimWords.noCap : ClaimWords.upTo(caps),
      if (t.claimWithinDays != null) ClaimWords.within(t.claimWithinDays!),
    ].join(' · ');
    double left(double cap, double used) => (cap - used) < 0 ? 0 : cap - used;
    final most = t.most;
    return [
      [t.nameEn, ?t.nameAr].join(' · '),
      ?t.description,
      rules,
      if (t.capPerClaim != null) ClaimWords.aClaim(egp(t.capPerClaim!)),
      if (t.capPerMonth != null)
        ClaimWords.monthLeft(monthNameOf(_date.substring(0, 7)), egp(left(t.capPerMonth!, t.usedInMonth)), egp(t.capPerMonth!), egp(t.usedInMonth)),
      if (t.capPerYear != null) ClaimWords.yearLeft(_date.substring(0, 4), egp(left(t.capPerYear!, t.usedInYear)), egp(t.capPerYear!), egp(t.usedInYear)),
      most == null ? ClaimWords.anyAmount : ClaimWords.canClaimUpTo(egp(most)),
    ];
  }

  List<String> _problems(ReimbursementType? t, double? amount) {
    final today = todayIso();
    final out = <String>[];
    if (t == null) out.add(ClaimWords.chooseTypeProblem);
    if (amount == null) out.add(ClaimWords.enterAmount);
    if (_date.compareTo(today) > 0) {
      out.add(ClaimWords.afterToday);
    } else if (t?.claimWithinDays != null) {
      final age = daysBetween(_date, today);
      if (age > t!.claimWithinDays!) out.add(ClaimWords.tooLate(t.claimWithinDays!, age));
    }
    if (t != null && t.receiptRequired && _photos.isEmpty) out.add(ClaimWords.attachReceipt);
    if (t != null && amount != null) {
      const cent = 0.005;
      if (t.capPerClaim != null && amount > t.capPerClaim! + cent) out.add(ClaimWords.atMostAtOnce(t.capPerClaim!));
      if (t.capPerMonth != null) {
        final left = (t.capPerMonth! - t.usedInMonth).clamp(0, double.infinity).toDouble();
        if (amount > left + cent) out.add(ClaimWords.onlyLeftMonth(left, t.capPerMonth!));
      }
      if (t.capPerYear != null) {
        final left = (t.capPerYear! - t.usedInYear).clamp(0, double.infinity).toDouble();
        if (amount > left + cent) out.add(ClaimWords.onlyLeftYear(left, t.capPerYear!));
      }
    }
    if (_what.text.trim().isEmpty) out.add(ClaimWords.describe);
    if (_photos.any((p) => p.bytes.length > 10 * 1024 * 1024)) out.add(ClaimWords.receiptTooBig);
    return out;
  }

  Future<void> _send(ReimbursementType t, double amount) async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendForm(
        ref,
        RequestPaths.create(RequestKind.claim),
        {'typeId': t.id, 'expenseDate': _date, 'amount': amount.toStringAsFixed(2), 'description': _what.text.trim()},
        [for (final p in _photos) ('receipts', p)],
      );
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.claim, json);
      widget.sent(made, ClaimWords.sent(made.status, made.manager, made.confidential));
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
    final async = ref.watch(reimbursementTypesProvider(_date));
    if (async.hasValue) _types = async.value;
    final types = _types;
    if (types == null) {
      if (async.hasError) {
        final e = async.error;
        if (isUnavailable(e)) return const SheetState.refused(ClaimWords.notAvailable);
        if (e is ApiException && e.status == 403) return const SheetState.refused(ClaimWords.cannotClaim);
        return SheetState.failed(onRetry: () => ref.invalidate(reimbursementTypesProvider(_date)));
      }
      return const SheetState.loading();
    }
    if (types.isEmpty && !async.isLoading) return const SheetState.refused(ClaimWords.noTypes);
    _typeId ??= types.length == 1 ? types.first.id : null;
    final t = types.where((x) => x.id == _typeId).firstOrNull;
    final amount = amountOf(_amount.text);
    final toCeo = ref.watch(confidentialProvider).value ?? false;
    final problems = _problems(t, amount);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: ClaimWords.type,
          hint: ClaimWords.typeHint,
          child: types.length <= 6
              ? ChoicePills<String>(
                  values: [for (final x in types) x.id],
                  labelOf: (id) => types.firstWhere((x) => x.id == id).nameEn,
                  selected: _typeId,
                  onChanged: (id) => setState(() => _typeId = id),
                )
              : PickListField<String>(
                  key: ValueKey(types.map((x) => x.id).join()),
                  label: ClaimWords.type,
                  value: _typeId,
                  items: [for (final x in types) (x.id, x.nameEn)],
                  onChanged: (id) => setState(() => _typeId = id),
                  placeholder: ClaimWords.chooseType,
                ),
        ),
        if (t != null) RulesNote(lines: [..._panel(t), if (async.isLoading) ClaimWords.checking(monthNameOf(_date.substring(0, 7)))]),
        SheetField(
          label: ClaimWords.date,
          hint: ClaimWords.dateHint(t?.claimWithinDays),
          child: PickDayField(
            label: ClaimWords.date,
            value: _date,
            first: addDays(todayIso(), -366),
            last: todayIso(),
            onChanged: (d) => setState(() => _date = d),
          ),
        ),
        SheetField(
          label: ClaimWords.amount,
          hint: ClaimWords.amountHint,
          child: SheetTextBox(
            controller: _amount,
            label: ClaimWords.amount,
            hint: '250.50',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
          ),
        ),
        SheetField(
          label: ClaimWords.what,
          hint: ClaimWords.whatHint,
          child: SheetTextBox(controller: _what, label: ClaimWords.what, lines: 3, max: 500, onChanged: (_) => setState(() {})),
        ),
        SheetField(
          label: t?.receiptRequired == true ? ClaimWords.receiptsRequired : ClaimWords.receipts,
          optional: t?.receiptRequired != true,
          hint: ClaimWords.receiptsHint,
          child: PhotosField(photos: _photos, max: 5, onChanged: (p) => setState(() => _photos = p)),
        ),
        SendChecks(problems: problems, ready: t == null || amount == null ? null : ClaimWords.ready(egp(amount), t.nameEn, _photos.length, toCeo)),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty && t != null && amount != null ? () => _send(t, amount) : null),
      ],
    );
  }
}

// ---------- its page ----------

/// "the direct manager", "HR", "Finance": who decided at a stage.
String _stagePhrase(String stage, Approver? manager) => switch (stage) {
  'manager' => approverPhrase(manager),
  'hr' => 'HR',
  'finance' => 'Finance',
  _ => stage,
};

String _stageOwner(String stage) => stage == 'finance' ? 'Finance' : 'HR';

/// Where a claim stands (apps/web reimbursements/list.ts progressText).
String claimProgressText(ReimbursementClaim c) {
  final ceo = c.confidential;
  switch (c.status) {
    case 'with_manager':
      return ClaimWords.withApprover(c.manager);
    case 'with_hr':
      return ClaimWords.waitingForHr(ceo);
    case 'with_finance':
      return ClaimWords.waitingForFinance(ceo);
    case 'rejected':
      final stage = c.rejectedStage;
      if (ceo && (stage == 'hr' || stage == 'finance')) return ClaimWords.rejectedAtStage(_stageOwner(stage!));
      return stage == null ? ClaimWords.rejected : ClaimWords.rejectedBy(_stagePhrase(stage, c.manager));
    case 'cancelled':
      return ClaimWords.cancelledByEmployee;
    default:
      final month = c.payrollMonth ?? c.payMonth;
      if (month == null) return ClaimWords.approved;
      final name = monthNameOf(month.substring(0, 7));
      if (c.payrollStatus == 'applied') return ClaimWords.paidWithPayroll(name);
      if (c.payrollStatus == 'cancelled') return ClaimWords.additionCancelled(name);
      return ClaimWords.toBePaid(name);
  }
}

/// A claim's step in words, with its amount (apps/web reimbursements/list.ts stepText).
String claimStepText(RequestStep s, Approver? manager, bool confidential) {
  final amount = s.amount == null ? null : egp(s.amount!);
  String withAmount(String title) => amount == null ? title : '$title · $amount';
  switch (s.kind) {
    case 'submitted':
      return withAmount(ClaimWords.claimedByEmployee);
    case 'no_manager':
      return ClaimWords.noManager;
    case 'manager_decision':
    case 'hr_decision':
    case 'finance_decision':
      final stage = s.kind.replaceFirst('_decision', '');
      if (confidential && stage != 'manager') {
        final owner = _stageOwner(stage);
        if (s.decision == 'reject') return ClaimWords.rejectedAtStage(owner);
        return withAmount(s.decision == 'approve_other' ? ClaimWords.lowerAtStage(owner) : ClaimWords.approvedAtStage(owner));
      }
      final phrase = _stagePhrase(stage, manager);
      final who = phrase[0].toUpperCase() + phrase.substring(1);
      if (s.decision == 'reject') return ClaimWords.whoRejected(who);
      return withAmount(s.decision == 'approve_other' ? ClaimWords.whoApprovedLower(who) : ClaimWords.whoApproved(who));
    case 'cancelled':
      return ClaimWords.cancelledByEmployee;
    case 'added_to_payroll':
      final title = ClaimWords.addedToPayroll(s.payMonth == null ? null : monthNameOf(s.payMonth!.substring(0, 7)));
      return amount == null ? title : '$title · ${ClaimWords.untaxed(amount)}';
    default:
      return stepTextOf(s, manager, confidential);
  }
}

/// What a claim's page shows.
RequestDetail claimDetail(ReimbursementClaim r) {
  final approved = r.approvedAmount;
  final lower = approved != null && (approved * 100).round() < (r.amount * 100).round();
  final month = r.payrollMonth ?? r.payMonth;
  return basicDetail(
    r,
    title: ClaimWords.claimTitle(r.typeName),
    progress: claimProgressText(r),
    stepText: (s) => claimStepText(s, r.manager, r.confidential),
    facts: [
      (label: ClaimWords.typeFact, value: r.typeName, note: r.typeNameAr),
      (label: ClaimWords.dateFact, value: dayWords(r.expenseDate), note: null),
      (label: ClaimWords.amountClaimed, value: egp(r.amount), note: null),
      if (approved != null && r.status != 'rejected')
        (label: r.status == 'approved' ? ClaimWords.amountApproved : ClaimWords.approvedSoFar, value: egp(approved), note: lower ? ClaimWords.lessThanClaimed : null),
      (label: ClaimWords.what, value: r.description, note: null),
      if (r.status == 'approved' && month != null) (label: ClaimWords.paidWith, value: ClaimWords.payrollUntaxed(monthNameOf(month.substring(0, 7))), note: null),
    ],
    files: [
      for (final (i, f) in r.receipts.indexed)
        fileLineOf(f.fileName.isEmpty ? RequestFile(id: f.id, fileName: ClaimWords.receiptN(i + 1), mimeType: f.mimeType, sizeBytes: f.sizeBytes) : f),
    ],
    filesTitle: ClaimWords.receiptsTitle,
    filesEmpty: r.receiptRequired ? ClaimWords.noReceipt : ClaimWords.noReceiptNeeded2,
    actions: [
      if (r.canCancel)
        (
          title: ClaimWords.cancelTitle,
          explain: ClaimWords.cancelExplain,
          button: ClaimWords.cancelButton,
          confirm: ClaimWords.cancelConfirm(r.typeName, egp(r.amount)),
          path: RequestPaths.action(RequestKind.claim, r.id, 'cancel'),
          done: ClaimWords.cancelled,
        ),
    ],
  );
}
