import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/timesheet.dart';
import '../../shell/app_shell.dart' show tabPagePadding;
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../requests/approvals.dart' show ApproveWords, askWhyRejected;
import '../requests/request_text.dart' show dmy, hoursShort, weekdayName;
import '../requests/requests_data.dart' show requestsChanged;
import '../requests/sheet_parts.dart' show refusalOf;
import 'timesheet_data.dart';
import 'timesheet_words.dart';

// A week of someone's hours, as the one who approves it reads it (owner, 4 November 2026: "Direct manager, weekly"):
// whose, which week, its hours, each day's lines, where it stands; Reject (with why) and Approve while it waits for them.

class TimesheetWeekPage extends ConsumerStatefulWidget {
  const TimesheetWeekPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<TimesheetWeekPage> createState() => _TimesheetWeekPageState();
}

class _TimesheetWeekPageState extends ConsumerState<TimesheetWeekPage> {
  bool _busy = false;
  String? _notice;
  bool _noticeOk = true;

  Future<void> _decide(TimesheetWeek w, {required bool approve}) async {
    String? why;
    if (!approve) {
      why = await askWhyRejected(context);
      if (why == null || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      await decideTimesheet(ref, widget.id, approve: approve, reason: why);
      if (!mounted) return;
      setState(() {
        _notice = approve ? ApproveWords.approved(w.employeeName) : ApproveWords.rejected(w.employeeName);
        _noticeOk = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notice = refusalOf(e).join(' ');
        _noticeOk = false;
      });
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        timesheetsChanged(ref);
        requestsChanged(ref);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final loaded = ref.watch(oneTimesheetProvider(widget.id));
    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(oneTimesheetProvider(widget.id));
          await ref.read(oneTimesheetProvider(widget.id).future).then<void>((_) {}, onError: (_) {});
        },
        child: ListView(
          padding: tabPagePadding(context).copyWith(top: 4),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => Navigator.of(context).maybePop(),
                style: TextButton.styleFrom(padding: const EdgeInsets.only(left: 4, right: 12)),
                icon: Icon(CupertinoIcons.chevron_left, size: 16, color: p.ink),
                label: Text(MaterialLocalizations.of(context).backButtonTooltip, style: text.labelMedium),
              ),
            ),
            ...switch (loaded) {
              AsyncValue(value: final TimesheetWeek w) => [
                PageHead(eyebrow: TimesheetWords.week(w.weekStart, w.weekEnd), title: TimesheetWords.weekOf(w.employeeName)),
                const SizedBox(height: 16),
                SurfaceCard(
                  child: Row(
                    children: [
                      Expanded(child: Text(TimesheetWords.total(w.totalHours), style: text.titleLarge)),
                      if (w.status != null) Pill(TimesheetWords.status[w.status]!, strong: w.status == TimesheetStatus.approved),
                    ],
                  ),
                ),
                if (w.rejectReason != null && w.status == TimesheetStatus.rejected) ...[const SizedBox(height: 12), Notice(text: TimesheetWords.rejected(w.rejectReason), ok: false)],
                if (_notice != null) ...[const SizedBox(height: 12), Semantics(liveRegion: true, child: Notice(text: _notice!, ok: _noticeOk))],
                for (final d in w.days)
                  if (w.linesOn(d.date).isNotEmpty) ...[
                    const SizedBox(height: 12),
                    SurfaceCard(
                      padding: const EdgeInsets.fromLTRB(18, 14, 18, 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(child: Text('${weekdayName(d.date)} ${dmy(d.date)}', style: text.labelLarge)),
                              Text(hoursShort(d.hours), style: text.labelMedium),
                            ],
                          ),
                          for (final l in w.linesOn(d.date))
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(l.what, style: text.bodyLarge),
                                        if (l.note != null) Text(l.note!, style: text.bodySmall),
                                      ],
                                    ),
                                  ),
                                  Text(hoursShort(l.hours), style: text.bodyMedium),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                if (w.canDecide) ...[
                  const SizedBox(height: 16),
                  SurfaceCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(ApproveWords.decideTitle, style: text.titleLarge),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: _busy ? null : () => _decide(w, approve: false),
                                style: OutlinedButton.styleFrom(foregroundColor: p.danger, side: BorderSide(color: p.danger.withValues(alpha: 0.5)), minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                                child: const Text(ApproveWords.reject),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: FilledButton(
                                onPressed: _busy ? null : () => _decide(w, approve: true),
                                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                                child: Text(_busy ? ApproveWords.sending : ApproveWords.approve),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ],
              AsyncError(:final error) => [
                Notice(
                  text: error is ApiException ? error.message : TimesheetWords.notLoaded,
                  ok: false,
                  action: TimesheetWords.tryAgain,
                  onAction: () => ref.invalidate(oneTimesheetProvider(widget.id)),
                ),
              ],
              _ => [const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))],
            },
          ],
        ),
      ),
    );
  }
}
