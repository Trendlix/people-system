import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/requests.dart';
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

  Future<void> _approveAll(List<PeopleRequest> items) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(ApproveWords.approveAll(items.length)),
        content: Text(ApproveWords.approveAllAsk(items.length)),
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
    if (!mounted) return;
    setState(() => _all = false);
    requestsChanged(ref);
    _say(ApproveWords.allDone(done, failed));
  }

  @override
  Widget build(BuildContext context) {
    final waiting = ref.watch(waitingRequestsProvider).value;
    if (waiting == null || (waiting.items.isEmpty && !waiting.failed)) return const SizedBox.shrink();
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final items = waiting.items;
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
                if (items.isNotEmpty) Pill(ApproveWords.count(items.length), strong: true),
              ],
            ),
            if (waiting.failed) ...[const SizedBox(height: 10), Text(ApproveWords.someNotLoaded, style: text.bodySmall?.copyWith(color: p.muted))],
            for (final (i, r) in items.indexed) ...[
              if (i > 0) Divider(height: 1, color: p.line),
              _WaitingRow(
                request: r,
                busy: _all || _busy.contains(_key(r)),
                onApprove: () => _decide(r, approve: true),
                onReject: () => _decide(r, approve: false),
              ),
            ],
            if (items.length > 1) ...[
              const SizedBox(height: 6),
              FilledButton(
                onPressed: _all || _busy.isNotEmpty ? null : () => _approveAll(items),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                child: Text(_all ? ApproveWords.sending : ApproveWords.approveAll(items.length)),
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

/// One request waiting: whose, what and when; Reject and Approve; tapping it opens its page.
class _WaitingRow extends StatelessWidget {
  const _WaitingRow({required this.request, required this.busy, required this.onApprove, required this.onReject});

  final PeopleRequest request;
  final bool busy;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final row = historyRowOf(request);
    return InkWell(
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: request.kind, id: request.id, initial: request))),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            IconTile(kindIcons[request.kind] ?? CupertinoIcons.doc_text),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(request.employeeName, style: text.labelMedium),
                  const SizedBox(height: 2),
                  Text([row.title, if (row.when.isNotEmpty) row.when].join(' · '), style: text.bodySmall),
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
                icon: const Icon(CupertinoIcons.checkmark, size: 18),
                style: IconButton.styleFrom(minimumSize: const Size.square(Tokens.tapTarget)),
              ),
            ],
          ],
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
