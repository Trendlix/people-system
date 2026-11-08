import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/requests.dart';
import '../../models/timesheet.dart';
import '../timesheet/timesheet_data.dart';
import '../timesheet/timesheet_week_page.dart';
import '../timesheet/timesheet_words.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'history.dart';
import 'request_page.dart';
import 'requests_data.dart';
import 'sheet_parts.dart' show refusalOf;

// To approve in the app (owner, 4 November 2026: "For roles who approve requests, why there is no approve button in the
// app?"; asked, "Now: everyday requests"; README Phase 3, "Approve in one move"): at the top of the Requests tab, what
// waits for the person's step (as a direct manager, a lead, a head, HR, the CEO): leave, permission, work from home,
// official duty, compensatory days, attendance corrections and expense claims, oldest first, each approved in one tap or
// rejected with why; Approve all for the lot; each opening its page, which has the same two buttons. People checks who
// may decide again, and says why not in its words. A claim is approved for its amount (another amount on the website).
// Weeks of hours too (owner, 4 November 2026: timesheets), after the requests, each opening the week.

abstract final class ApproveWords {
  static const title = 'To approve';
  static String count(int n) => '$n waiting';
  static const approve = 'Approve';
  static const reject = 'Reject';
  static String approveAll(int n) => 'Approve all ($n)';
  static String approveAllAsk(int n) => 'Approve all $n requests waiting for you?';
  static const cancel = 'Cancel';
  static const whyTitle = 'Why you reject it';
  static const whyHint = 'E.g. the team is short that week';
  static const whyNeeded = 'Write why you reject it.';
  static String approved(String name) => 'Approved: $name.';
  static String rejected(String name) => 'Rejected: $name.';
  static String allDone(int done, int failed) => failed == 0 ? 'Approved $done.' : 'Approved $done; $failed couldn’t be: open them to see why.';
  static const someNotLoaded = 'Some requests waiting for you couldn’t be loaded. Pull to refresh.';
  static const decideTitle = 'Your decision';
  static const sending = 'Sending…';
  static String weekLine(String start, String end, double hours) => 'Hours · ${TimesheetWords.week(start, end)} · ${TimesheetWords.total(hours)}';
}

/// The card at the top of the Requests tab: nothing when nothing waits.
class ToApproveCard extends ConsumerStatefulWidget {
  const ToApproveCard({super.key});

  @override
  ConsumerState<ToApproveCard> createState() => _ToApproveCardState();
}

class _ToApproveCardState extends ConsumerState<ToApproveCard> {
  final _busy = <String>{};
  bool _all = false;

  String _key(PeopleRequest r) => '${r.kind.name}:${r.id}';
  String _weekKey(TimesheetListItem w) => 'timesheet:${w.id}';

  void _say(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _decide(PeopleRequest r, {required bool approve}) async {
    String? why;
    if (!approve) {
      why = await askWhyRejected(context);
      if (why == null || !mounted) return;
    }
    setState(() => _busy.add(_key(r)));
    try {
      await decideRequest(ref, r, approve: approve, reason: why);
      if (!mounted) return;
      _say(approve ? ApproveWords.approved(r.employeeName) : ApproveWords.rejected(r.employeeName));
    } on ApiException catch (e) {
      if (mounted) _say(refusalOf(e).join(' '));
    } finally {
      if (mounted) {
        setState(() => _busy.remove(_key(r)));
        requestsChanged(ref);
      }
    }
  }

  Future<void> _decideWeek(TimesheetListItem w, {required bool approve}) async {
    String? why;
    if (!approve) {
      why = await askWhyRejected(context);
      if (why == null || !mounted) return;
    }
    setState(() => _busy.add(_weekKey(w)));
    try {
      await decideTimesheet(ref, w.id, approve: approve, reason: why);
      if (!mounted) return;
      _say(approve ? ApproveWords.approved(w.employeeName) : ApproveWords.rejected(w.employeeName));
    } on ApiException catch (e) {
      if (mounted) _say(refusalOf(e).join(' '));
    } finally {
      if (mounted) {
        setState(() => _busy.remove(_weekKey(w)));
        timesheetsChanged(ref);
      }
    }
  }

  Future<void> _approveAll(List<PeopleRequest> items, List<TimesheetListItem> weeks) async {
    final n = items.length + weeks.length;
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(ApproveWords.approveAll(n)),
        content: Text(ApproveWords.approveAllAsk(n)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text(ApproveWords.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text(ApproveWords.approve)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _all = true);
    var done = 0;
    var failed = 0;
    for (final r in items) {
      try {
        await decideRequest(ref, r, approve: true);
        done++;
      } on ApiException {
        failed++;
      }
    }
    for (final w in weeks) {
      try {
        await decideTimesheet(ref, w.id, approve: true);
        done++;
      } on ApiException {
        failed++;
      }
    }
    if (!mounted) return;
    setState(() => _all = false);
    requestsChanged(ref);
    timesheetsChanged(ref);
    _say(ApproveWords.allDone(done, failed));
  }

  @override
  Widget build(BuildContext context) {
    final waiting = ref.watch(waitingRequestsProvider).value;
    final weeksRead = ref.watch(waitingTimesheetsProvider);
    final weeks = weeksRead.value ?? const <TimesheetListItem>[];
    final failed = (waiting?.failed ?? false) || weeksRead.hasError;
    final items = waiting?.items ?? const <PeopleRequest>[];
    if (waiting == null || (items.isEmpty && weeks.isEmpty && !failed)) return const SizedBox.shrink();
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final n = items.length + weeks.length;
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: SurfaceCard(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(ApproveWords.title, style: text.titleLarge)),
                if (n > 0) Pill(ApproveWords.count(n), strong: true),
              ],
            ),
            if (failed) ...[const SizedBox(height: 10), Text(ApproveWords.someNotLoaded, style: text.bodySmall?.copyWith(color: p.muted))],
            for (final (i, r) in items.indexed) ...[
              if (i > 0) Divider(height: 1, color: p.line),
              _WaitingRow(
                icon: kindIcons[r.kind] ?? CupertinoIcons.doc_text,
                name: r.employeeName,
                line: () {
                  final row = historyRowOf(r);
                  return [row.title, if (row.when.isNotEmpty) row.when].join(' · ');
                }(),
                // beside the list on an iPad in two panes (8 November 2026), else its page pushed
                onOpen: () => openRequest(context, r),
                selected: RequestPane.of(context)?.selected == requestKeyOf(r),
                busy: _all || _busy.contains(_key(r)),
                onApprove: () => _decide(r, approve: true),
                onReject: () => _decide(r, approve: false),
              ),
            ],
            // weeks of hours (4 November 2026)
            for (final (i, w) in weeks.indexed) ...[
              if (i > 0 || items.isNotEmpty) Divider(height: 1, color: p.line),
              _WaitingRow(
                icon: CupertinoIcons.timer,
                name: w.employeeName,
                line: ApproveWords.weekLine(w.weekStart, w.weekEnd, w.totalHours),
                onOpen: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TimesheetWeekPage(id: w.id))),
                busy: _all || _busy.contains(_weekKey(w)),
                onApprove: () => _decideWeek(w, approve: true),
                onReject: () => _decideWeek(w, approve: false),
              ),
            ],
            if (n > 1) ...[
              const SizedBox(height: 6),
              FilledButton(
                onPressed: _all || _busy.isNotEmpty ? null : () => _approveAll(items, weeks),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                child: Text(_all ? ApproveWords.sending : ApproveWords.approveAll(n)),
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

/// One thing waiting: whose, what and when; Reject and Approve; tapping it opens its page.
class _WaitingRow extends StatelessWidget {
  const _WaitingRow({required this.icon, required this.name, required this.line, required this.onOpen, required this.busy, required this.onApprove, required this.onReject, this.selected = false});

  final IconData icon;
  final String name;
  final String line;
  final VoidCallback onOpen;
  final bool busy;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  /// Open beside the list (an iPad in two panes, 8 November 2026): its row marked.
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return InkWell(
      onTap: onOpen,
      child: Ink(
        decoration: BoxDecoration(color: selected ? p.track : null),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              IconTile(icon),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: text.labelMedium),
                    const SizedBox(height: 2),
                    Text(line, style: text.bodySmall),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (busy)
                const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2))
              else ...[
                IconButton(
                  onPressed: onReject,
                  tooltip: ApproveWords.reject,
                  icon: Icon(CupertinoIcons.xmark, size: 18, color: p.danger),
                  style: IconButton.styleFrom(side: BorderSide(color: p.line), minimumSize: const Size.square(Tokens.tapTarget)),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  onPressed: onApprove,
                  tooltip: ApproveWords.approve,
                  // the tick in the button's own colour, not the theme's ink (it was dark on the black circle: 8 November
                  // 2026)
                  icon: Icon(CupertinoIcons.checkmark, size: 18, color: p.onPrimary),
                  style: IconButton.styleFrom(minimumSize: const Size.square(Tokens.tapTarget)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Why it is rejected, asked before (People needs it); null when they go back.
Future<String?> askWhyRejected(BuildContext context) => showDialog<String>(context: context, builder: (_) => const _WhyDialog());

class _WhyDialog extends StatefulWidget {
  const _WhyDialog();

  @override
  State<_WhyDialog> createState() => _WhyDialogState();
}

class _WhyDialogState extends State<_WhyDialog> {
  final _field = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  void _send() {
    final why = _field.text.trim();
    if (why.isEmpty) return setState(() => _error = ApproveWords.whyNeeded);
    Navigator.pop(context, why);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text(ApproveWords.whyTitle),
    content: TextField(
      controller: _field,
      autofocus: true,
      maxLength: 1000,
      minLines: 2,
      maxLines: 5,
      decoration: InputDecoration(hintText: ApproveWords.whyHint, errorText: _error),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text(ApproveWords.cancel)),
      FilledButton(onPressed: _send, child: const Text(ApproveWords.reject)),
    ],
  );
}
