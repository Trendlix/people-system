import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/attendance_correction.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_data.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';

/// My corrections (the Attendance tab's "My corrections"; the website's on My Requests and each correction's page): the
/// person's attendance corrections, the latest day first, each its day, what was wrong, the right times, what was on
/// record when asked, why, where it stands (with whom, rejected why, when the day was corrected) and every step; Cancel
/// while it is being decided.
class MyCorrectionsScreen extends ConsumerWidget {
  const MyCorrectionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final list = ref.watch(myCorrectionsProvider);
    return Material(
      color: p.canvas,
      child: RefreshIndicator(
        onRefresh: () => ref.refresh(myCorrectionsProvider.future),
        child: ListView(
          padding: tabPagePadding(context),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: IconTile(CupertinoIcons.arrow_left, tooltip: AttendanceWords.back, onCard: false, onTap: () => Navigator.of(context).maybePop()),
            ),
            const SizedBox(height: 8),
            const PageHead(eyebrow: AttendanceWords.correctionsEyebrow, title: AttendanceWords.myCorrections, intro: AttendanceWords.correctionsIntro),
            const SizedBox(height: 24),
            list.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => Notice(
                text: e is ApiException ? e.message : AttendanceWords.correctionsFailed,
                ok: false,
                action: AttendanceWords.tryAgain,
                onAction: () => ref.invalidate(myCorrectionsProvider),
              ),
              data: (all) => all.isEmpty
                  ? SurfaceCard(child: Text(AttendanceWords.noCorrections, style: text.bodyMedium?.copyWith(color: p.muted)))
                  : Column(
                      children: [
                        for (final c in all) ...[_CorrectionCard(correction: c), const SizedBox(height: 12)],
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CorrectionCard extends ConsumerStatefulWidget {
  const _CorrectionCard({required this.correction});

  final AttendanceCorrection correction;

  @override
  ConsumerState<_CorrectionCard> createState() => _CorrectionCardState();
}

class _CorrectionCardState extends ConsumerState<_CorrectionCard> {
  var _cancelling = false;

  Future<void> _cancel() async {
    final c = widget.correction;
    final day = AttendanceWords.dayTitle(c.date);
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AttendanceWords.cancelAsk(day)),
        content: const Text(AttendanceWords.cancelBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(AttendanceWords.keepIt)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(AttendanceWords.cancelIt)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _cancelling = true);
    try {
      await cancelCorrection(ref, c);
      messenger.showSnackBar(const SnackBar(content: Text(AttendanceWords.cancelled)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.status == 409 ? AttendanceWords.movedOn : e.message)));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final c = widget.correction;
    final before = c.dayBefore;
    final small = text.bodySmall;
    final status = AttendanceWords.statusOfCorrection(c.status, confidential: c.confidential);
    final stands = switch (c.status) {
      'with_manager' => AttendanceWords.withApprover(c.managerRole, c.managerName),
      'approved' when c.appliedAt != null => AttendanceWords.appliedOn(momentText(c.appliedAt!)),
      _ => status,
    };
    Widget fact(String label, Widget value) => Padding(
      padding: const EdgeInsets.only(top: 14),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [Text(label, style: small), const SizedBox(height: 3), value],
        ),
      ),
    );
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(
            eyebrow: AttendanceWords.dayTitle(c.date),
            title: AttendanceWords.kindName(c.kind),
            trailing: Pill(status, strong: c.status == 'approved'),
          ),
          const SizedBox(height: 4),
          Text(c.recordedByHr ? AttendanceWords.correctedByHr : (c.createdAt == null ? '' : AttendanceWords.sentOn(momentText(c.createdAt!))), style: small),
          fact(
            AttendanceWords.rightTimes,
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(rightTimesText(c.checkIn, c.checkOut), style: text.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                if (c.kind == 'worked_remotely') Text(AttendanceWords.remoteNote, style: small),
              ],
            ),
          ),
          fact(
            AttendanceWords.onRecordWhenAsked,
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(onRecordText(known: before != null, status: before?.status, checkIn: before?.checkIn, checkOut: before?.checkOut), style: text.bodyLarge),
                if (before != null) Text(AttendanceWords.sourceOf(before.source), style: small),
              ],
            ),
          ),
          if (c.reason.isNotEmpty) fact(AttendanceWords.why, Text(c.reason, style: text.bodyLarge)),
          fact(AttendanceWords.whereItStands, Text(stands, style: text.bodyLarge)),
          if (c.status == 'rejected' && c.rejectReason != null) fact(AttendanceWords.rejectedBecause, Text(c.rejectReason!, style: text.bodyLarge)),
          if (c.steps.isNotEmpty) ...[
            const SizedBox(height: 18),
            Divider(color: p.line, height: 1),
            const SizedBox(height: 14),
            Text(AttendanceWords.everyStep, style: text.titleSmall),
            const SizedBox(height: 6),
            for (final s in c.steps)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: MergeSemantics(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: s.decision == 'reject' ? p.danger : p.ink),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(AttendanceWords.step(s.kind, s.decision, managerRole: c.managerRole, confidential: c.confidential), style: text.bodyMedium),
                            Text(
                              [
                                ?s.actor,
                                if (s.onBehalfOf != null) AttendanceWords.standingIn(s.onBehalfOf!),
                                momentText(s.at),
                              ].join(' · '),
                              style: small,
                            ),
                            if (s.comment != null) Text('“${s.comment}”', style: text.bodyMedium?.copyWith(color: p.muted)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
          if (c.canCancel) ...[
            const SizedBox(height: 18),
            OutlinedButton(
              onPressed: _cancelling ? null : _cancel,
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, Tokens.tapTarget), textStyle: text.labelMedium),
              child: Text(_cancelling ? AttendanceWords.cancelling : AttendanceWords.cancelTitle),
            ),
          ],
        ],
      ),
    );
  }
}
