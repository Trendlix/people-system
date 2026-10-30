import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/requests.dart';
import '../../providers.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'kinds/claim.dart';
import 'kinds/compensatory.dart';
import 'kinds/correction.dart';
import 'kinds/home.dart';
import 'kinds/leave.dart';
import 'kinds/od.dart';
import 'kinds/permission.dart';
import 'kinds/resignation.dart';
import 'kinds/wfh.dart';
import 'request_text.dart';
import 'requests_data.dart';
import 'requests_words.dart';
import 'sheet_parts.dart' show refusalOf;

// A request's own page, pushed inside the Requests tab (the website's request pages, in the phone design's style): what
// it is, where it stands, who decides it, its files, every step as it was taken, and what its employee may still do
// (cancel it, withdraw it). Each kind says what it shows (kinds/*.dart); the page draws them alike.

/// The icon each kind shows, in Recent requests, on its card to start one and on its page.
const kindIcons = {
  RequestKind.leave: CupertinoIcons.calendar,
  RequestKind.permission: CupertinoIcons.clock,
  RequestKind.correction: CupertinoIcons.calendar_badge_plus,
  RequestKind.wfh: CupertinoIcons.house,
  RequestKind.od: CupertinoIcons.briefcase,
  RequestKind.compensatory: CupertinoIcons.arrow_right_arrow_left,
  RequestKind.home: CupertinoIcons.location,
  RequestKind.claim: CupertinoIcons.doc_text,
  RequestKind.resignation: CupertinoIcons.square_arrow_right,
};

/// A line of what a request is: its label, its value, and a note under it.
typedef Fact = ({String label, String value, String? note});

/// A step as the page shows it: what happened, the comment given, who and when; [tone] the dot's (approved, rejected).
typedef StepLine = ({String text, String? comment, String who, RequestState? tone});

/// Something its employee may still do: its words, what it does, the question asked first, where it is sent, and what
/// the page says once done.
typedef RequestAction = ({String title, String explain, String button, String confirm, String path, String done});

/// What a request's page shows, as its kind says it.
class RequestDetail {
  const RequestDetail({
    required this.title,
    required this.status,
    required this.state,
    required this.subline,
    required this.facts,
    required this.steps,
    this.files,
    this.filesTitle,
    this.filesEmpty,
    this.notes = const [],
    this.actions = const [],
    this.banner,
  });

  final String title;
  final String status;
  final RequestState state;

  /// Who sent it and when ("Sent 26/10/2026, 9:05 AM").
  final String subline;
  final List<Fact> facts;
  final List<StepLine> steps;

  /// Its documents, receipts or letter, each in a line; null: the kind keeps none.
  final List<String>? files;
  final String? filesTitle;
  final String? filesEmpty;

  /// Lines under the facts (what an approval means, where the others are).
  final List<String> notes;
  final List<RequestAction> actions;

  /// A line over everything (it goes with an official duty).
  final String? banner;
}

/// The parts every leave-like request shows alike: where it stands (with the reason given), who decides first, what HR
/// recorded it past; its steps in words ([stepText] for a kind's own); [subline], [progress] and who decides
/// ([decider]) its own when given.
RequestDetail basicDetail(
  PeopleRequest r, {
  required String title,
  required List<Fact> facts,
  String Function(RequestStep s)? stepText,
  String? subline,
  List<String> notes = const [],
  List<RequestAction> actions = const [],
  List<String>? files,
  String? filesTitle,
  String? filesEmpty,
  String? banner,
  String? progress,
  String? decider,
}) {
  final where = progressOf(r);
  final hr = RequestsWords.hrStage(r.confidential);
  return RequestDetail(
    title: title,
    status: statusLabelOf(r),
    state: stateOf(r),
    subline: subline ?? (r.recordedByHr ? '${RequestsWords.recordedByHr} ${dateTimeWords(r.createdAt)}' : RequestsWords.sentOn(dateTimeWords(r.createdAt))),
    facts: [
      ...facts,
      (label: RequestsWords.whereItStands, value: progress ?? where.text, note: where.reason == null ? null : '“${where.reason}”'),
      (
        label: approverLabel(r.manager),
        value: decider ?? (r.recordedByHr ? RequestsWords.recordedNoDecision : (r.manager?.name ?? RequestsWords.noneSentStraightTo(hr))),
        note: null,
      ),
      if (r.warnings.isNotEmpty) (label: RequestsWords.recordedPast, value: r.warnings.join('\n'), note: null),
    ],
    steps: stepLinesOf(r, stepText),
    notes: notes,
    actions: actions,
    files: files,
    filesTitle: filesTitle,
    filesEmpty: filesEmpty,
    banner: banner,
  );
}

/// A request's steps as the page lists them.
List<StepLine> stepLinesOf(PeopleRequest r, [String Function(RequestStep s)? stepText]) => [
  for (final s in r.steps)
    (
      text: stepText?.call(s) ?? stepTextOf(s, r.manager, r.confidential),
      comment: s.comment,
      who: stepWhoLine(s),
      tone: s.decision == 'reject' ? RequestState.closed : (s.decision != null || s.kind == 'recorded_by_hr' ? RequestState.approved : null),
    ),
];

/// A file as its line: "receipt.jpg · Photo · 240 KB".
String fileLineOf(RequestFile f) => RequestsWords.fileLine(f.fileName, f.mimeType == 'application/pdf' ? RequestsWords.pdf : RequestsWords.photo, sizeText(f.sizeBytes));

/// What a request's page shows, by its kind.
RequestDetail detailOf(PeopleRequest r) => switch (r) {
  LeaveRequest() => leaveDetail(r),
  PermissionRequest() => permissionDetail(r),
  CorrectionRequest() => correctionDetail(r),
  WfhRequest() => wfhDetail(r),
  OdRequest() => odDetail(r),
  CompensatoryRequest() => compensatoryDetail(r),
  HomeLocationRequest() => homeDetail(r),
  ReimbursementClaim() => claimDetail(r),
  ResignationRequest() => resignationDetail(r),
  _ => basicDetail(r, title: r.kind.name, facts: const []),
};

/// The page: read again from People when opened without the request in hand, or pulled down.
class RequestPage extends ConsumerStatefulWidget {
  const RequestPage({super.key, required this.kind, required this.id, this.initial, this.notice});

  final RequestKind kind;
  final String id;
  final PeopleRequest? initial;

  /// What was just done (sent, cancelled), said at the top.
  final String? notice;

  @override
  ConsumerState<RequestPage> createState() => _RequestPageState();
}

class _RequestPageState extends ConsumerState<RequestPage> {
  PeopleRequest? _request;
  String? _notice;
  bool _noticeOk = true;
  String? _failed;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _request = widget.initial;
    _notice = widget.notice;
    if (_request == null) _load();
  }

  Future<void> _load() async {
    try {
      final r = requestOf(widget.kind, await ref.read(peopleClientProvider).get(RequestPaths.one(widget.kind, widget.id)));
      if (mounted) {
        setState(() {
          _request = r;
          _failed = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _failed = e.status == 404 || e.status == 403 ? RequestsWords.notYours : e.message);
    }
  }

  Future<void> _act(RequestAction a) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(a.title),
        content: Text(a.confirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(RequestsWords.keepIt)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(a.button)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final json = await sendJson(ref, a.path);
      if (!mounted) return;
      requestsChanged(ref);
      setState(() {
        _request = requestOf(widget.kind, json);
        _notice = a.done;
        _noticeOk = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      requestsChanged(ref);
      setState(() {
        _notice = refusalOf(e).join(' ');
        _noticeOk = false;
      });
      if (e.status == 409) await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final r = _request;
    final d = r == null ? null : detailOf(r);
    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: tabPagePadding(context).copyWith(top: 4),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => Navigator.of(context).maybePop(),
                style: TextButton.styleFrom(padding: const EdgeInsets.only(left: 4, right: 12)),
                icon: Icon(CupertinoIcons.chevron_left, size: 16, color: p.ink),
                label: Text(RequestsWords.title, style: text.labelMedium),
              ),
            ),
            const SizedBox(height: 6),
            if (d == null) ...[
              if (_failed == null)
                const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                )
              else
                Notice(text: _failed!, ok: false, action: RequestsWords.tryAgain, onAction: _load),
            ] else ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: PageHead(eyebrow: RequestsWords.theRequest, title: d.title),
                  ),
                  const SizedBox(width: 12),
                  Padding(
                    padding: const EdgeInsets.only(top: 22),
                    child: IconTile(kindIcons[widget.kind] ?? CupertinoIcons.doc_text, onCard: false),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  StatusBadge(label: d.status, state: d.state),
                  Text(d.subline, style: text.bodySmall),
                ],
              ),
              if (d.banner != null) ...[const SizedBox(height: 14), Notice(text: d.banner!, ok: true)],
              if (_notice != null) ...[
                const SizedBox(height: 14),
                Semantics(
                  liveRegion: true,
                  child: Notice(text: _notice!, ok: _noticeOk),
                ),
              ],
              const SizedBox(height: 20),
              SurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, f) in d.facts.indexed) ...[
                      if (i > 0) Divider(height: 26, color: p.line),
                      Text(f.label, style: text.bodySmall),
                      const SizedBox(height: 3),
                      Text(f.value, style: text.bodyLarge),
                      if (f.note != null) ...[const SizedBox(height: 2), Text(f.note!, style: text.bodySmall)],
                    ],
                    for (final n in d.notes) ...[const SizedBox(height: 16), Text(n, style: text.bodySmall)],
                  ],
                ),
              ),
              if (d.files != null) ...[
                const SizedBox(height: 16),
                SurfaceCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(d.filesTitle ?? '', style: text.titleLarge),
                      const SizedBox(height: 12),
                      if (d.files!.isEmpty) Text(d.filesEmpty ?? '', style: text.bodyMedium?.copyWith(color: p.muted)),
                      for (final f in d.files!)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            children: [
                              Icon(CupertinoIcons.paperclip, size: 16, color: p.ink),
                              const SizedBox(width: 8),
                              Expanded(child: Text(f, style: text.bodyMedium)),
                            ],
                          ),
                        ),
                      if (d.files!.isNotEmpty) Text(RequestsWords.filesKeptOnWebsite, style: text.bodySmall),
                    ],
                  ),
                ),
              ],
              for (final a in d.actions) ...[
                const SizedBox(height: 16),
                SurfaceCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(a.title, style: text.titleLarge),
                      const SizedBox(height: 8),
                      Text(a.explain, style: text.bodyMedium?.copyWith(color: p.muted)),
                      const SizedBox(height: 14),
                      OutlinedButton(
                        onPressed: _busy ? null : () => _act(a),
                        style: OutlinedButton.styleFrom(foregroundColor: p.danger, side: BorderSide(color: p.danger.withValues(alpha: 0.5))),
                        child: Text(_busy ? RequestsWords.sending : a.button),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(RequestsWords.everyStep, style: text.titleLarge),
                    const SizedBox(height: 14),
                    if (d.steps.isEmpty) Text(RequestsWords.noSteps, style: text.bodyMedium?.copyWith(color: p.muted)),
                    for (final (i, s) in d.steps.indexed) _StepRow(step: s, last: i == d.steps.length - 1),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Where a request stands, as a badge: approved filled, waiting quiet with a dot, closed quiet.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.state, this.small = false});

  final String label;
  final RequestState state;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final strong = state == RequestState.approved;
    final fg = strong ? p.onPrimary : (state == RequestState.waiting ? p.ink : p.muted);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: small ? 9 : 11, vertical: small ? 4 : 6),
      decoration: BoxDecoration(
        color: strong ? p.primary : p.raised,
        borderRadius: BorderRadius.circular(Tokens.radiusPill),
        border: strong ? null : Border.all(color: p.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (state == RequestState.waiting) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(shape: BoxShape.circle, color: p.ink),
            ),
            const SizedBox(width: 6),
          ],
          Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg, fontSize: small ? 12 : null)),
        ],
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.step, required this.last});

  final StepLine step;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final dot = switch (step.tone) {
      RequestState.approved => p.ink,
      RequestState.closed => p.danger,
      _ => p.muted,
    };
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 20,
            child: Column(
              children: [
                Container(
                  margin: const EdgeInsets.only(top: 5),
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: step.tone == null ? p.card : dot,
                    border: Border.all(color: dot, width: 1.5),
                  ),
                ),
                Expanded(child: Container(width: 1, color: last ? Colors.transparent : p.line)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(step.text, style: text.bodyLarge),
                  if (step.comment != null) Text('“${step.comment}”', style: text.bodyMedium),
                  if (step.who.isNotEmpty) Text(step.who, style: text.bodySmall),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
