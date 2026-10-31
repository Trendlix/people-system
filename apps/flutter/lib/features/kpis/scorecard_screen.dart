import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/kpi.dart';
import '../../providers.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'kpi_data.dart';
import 'kpi_parts.dart';
import 'kpi_words.dart';

// A KPI scorecard (owner, 21 October 2026: "Self, manager, HR, sign-off"; 31 October 2026: "employees and managers can
// perform the KPI's from the mobile app"), as the website's scorecard page has it (apps/web kpis/scorecards/[id]): who
// and which month, where it stands and by when, who scores it, the payroll it counts in; the score with its pillars and
// metrics; and while it waits for the caller, their step: the employee's self-rating, the scorer's scoring (the
// self-rating beside each metric; sent once the self-rating is in or its day has passed, with the comments), each picked
// criterion by criterion with the score worked out live (kpiScore), saved for later or sent; and the sign-off, "I've
// read it", by the employee and by the manager. HR's calibration stays on the website. The comments and every step
// follow. The API checks every step again; what it refuses is said in its words, and a scorecard that moved on
// meanwhile shows where it stands now.

/// What the caller does on the scorecard's metrics now: reads them, rates themself, or scores them.
enum KpiSheetMode { view, self, score }

class ScorecardScreen extends ConsumerStatefulWidget {
  const ScorecardScreen({super.key, required this.id, this.back = KpiWords.myTitle});

  final String id;

  /// The page it goes back to ("My KPIs", "Team KPIs").
  final String back;

  @override
  ConsumerState<ScorecardScreen> createState() => _ScorecardScreenState();
}

class _ScorecardScreenState extends ConsumerState<ScorecardScreen> {
  KpiScorecardView? _view;
  String? _failed;
  ({String text, bool ok})? _notice;

  /// What is being sent: 'send', 'save' or 'sign'; null when nothing is.
  String? _busy;

  Map<String, int?> _picks = {};
  final _notes = <String, TextEditingController>{};
  final _openNotes = <String>{};
  final _comment = TextEditingController();
  final _signComment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _notes.values) {
      c.dispose();
    }
    _comment.dispose();
    _signComment.dispose();
    super.dispose();
  }

  KpiSheetMode _modeOf(KpiScorecardView v) => v.can.selfRate ? KpiSheetMode.self : (v.can.score ? KpiSheetMode.score : KpiSheetMode.view);

  /// The form as the scorecard has it now: the caller's own picks and comments so far.
  void _take(KpiScorecardView v) {
    final mode = _modeOf(v);
    int? valid(KpiMetric m, int? c) => c != null && c >= 0 && c < m.criteria.length ? c : null;
    _picks = {
      for (final m in v.metrics)
        m.id: valid(m, switch (mode) {
          KpiSheetMode.self => m.self?.choice,
          KpiSheetMode.score => m.manager?.choice,
          KpiSheetMode.view => countedChoice(m),
        }),
    };
    // the fields kept (they may still be on screen), their words as the scorecard has them now
    _openNotes.clear();
    for (final m in v.metrics) {
      final note = switch (mode) {
        KpiSheetMode.self => m.self?.comment,
        KpiSheetMode.score => m.manager?.comment,
        KpiSheetMode.view => null,
      };
      (_notes[m.id] ??= TextEditingController()).text = note ?? '';
      if (note != null) _openNotes.add(m.id);
    }
    _comment.text = switch (mode) {
      KpiSheetMode.self => v.comments.self ?? '',
      KpiSheetMode.score => v.comments.manager ?? '',
      KpiSheetMode.view => '',
    };
    _signComment.clear();
    _view = v;
  }

  Future<void> _load() async {
    try {
      final v = KpiScorecardView.fromJson(await ref.read(peopleClientProvider).get(KpiPaths.one(widget.id)));
      if (!mounted) return;
      setState(() {
        _take(v);
        _failed = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _failed = e.status == 404 || e.status == 403 ? KpiWords.notYours : e.messages.map(kpiMessage).join(' '));
    } on FormatException {
      if (mounted) setState(() => _failed = KpiWords.notLoaded);
    }
  }

  /// Sends a step; once People has kept it, the scorecard as it is now and what was done. A scorecard that moved on
  /// meanwhile (409) is read again, saying so; any other refusal is said in People's words, the form kept.
  Future<void> _step(String path, Map<String, Object?> body, String done, String busy) async {
    setState(() {
      _busy = busy;
      _notice = null;
    });
    try {
      final v = KpiScorecardView.fromJson(await ref.read(peopleClientProvider).post(path, body));
      if (!mounted) return;
      kpisChanged(ref);
      setState(() {
        _take(v);
        _notice = doneText(done, v);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 409) {
        kpisChanged(ref);
        await _load();
        if (mounted) setState(() => _notice = (text: KpiWords.moved, ok: false));
      } else {
        setState(() => _notice = (text: e.messages.map(kpiMessage).join(' '), ok: false));
      }
    } on FormatException {
      if (mounted) setState(() => _notice = (text: KpiWords.notLoaded, ok: false));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _sendPicks(KpiScorecardView v, KpiSheetMode mode, {required bool submit}) async {
    final comment = _comment.text.trim();
    if (submit) {
      // the manager scores with comments (owner's brief, 21 October 2026: "The manager scores with comments")
      if (mode == KpiSheetMode.score && comment.isEmpty) {
        setState(() => _notice = (text: KpiWords.writeComments, ok: false));
        return;
      }
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: Text(mode == KpiSheetMode.self ? KpiWords.confirmSelf : KpiWords.confirmScore(v.card.employee?.fullNameEn ?? '')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(KpiWords.cancel)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(mode == KpiSheetMode.self ? KpiWords.sendSelf : KpiWords.sendScoring)),
          ],
        ),
      );
      if (yes != true || !mounted) return;
    }
    final body = {
      'picks': [
        for (final m in v.metrics)
          {'metricId': m.id, 'choice': _picks[m.id], 'comment': (_notes[m.id]?.text.trim() ?? '').isEmpty ? null : _notes[m.id]!.text.trim()},
      ],
      'comment': comment.isEmpty ? null : comment,
      'submit': submit,
    };
    final self = mode == KpiSheetMode.self;
    await _step(
      self ? KpiPaths.self(v.card.id) : KpiPaths.score(v.card.id),
      body,
      self ? (submit ? 'self_sent' : 'self_saved') : (submit ? 'score_sent' : 'score_saved'),
      submit ? 'send' : 'save',
    );
  }

  Future<void> _sign(KpiScorecardView v) async {
    final comment = _signComment.text.trim();
    await _step(KpiPaths.sign(v.card.id), {'comment': comment.isEmpty ? null : comment}, 'signed', 'sign');
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final v = _view;
    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: tabPagePadding(context).copyWith(top: 4),
          children: [
            KpiBack(widget.back),
            const SizedBox(height: 6),
            if (v == null)
              _failed == null ? const KpiLoading() : KpiLoadFailed(text: _failed!, onRetry: _load)
            else
              ..._page(context, v),
          ],
        ),
      ),
    );
  }

  List<Widget> _page(BuildContext context, KpiScorecardView v) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final me = ref.watch(authProvider).value;
    final myEmployee = me is SignedIn ? me.me.employeeId : null;
    final own = myEmployee != null && v.card.employee?.id == myEmployee;
    final mode = _modeOf(v);
    final todo = actionText(v.card);
    final where = [?v.card.jobTitle, ?v.card.department].join(' · ');
    final editing = mode != KpiSheetMode.view;
    final attendance = v.attendance.counted ? (points: v.attendance.points, achieved: v.attendance.achieved) : null;
    final live = editing ? kpiScore(v.metrics, _picks, attendance, v.pillars, v.attendancePillar) : null;
    final shownPillars = live?.pillars ?? v.score?.pillars;
    return [
      PageHead(eyebrow: KpiWords.scorecard, title: monthNameOf(v.card.month)),
      const SizedBox(height: 12),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          KpiStatusPill(v.card),
          if (v.card.practice) const Pill(KpiWords.practice),
          if (v.card.confidential) const Pill(KpiWords.cLevel),
        ],
      ),
      const SizedBox(height: 10),
      Text('${own ? KpiWords.yours : (v.card.employee?.fullNameEn ?? '')}${where.isEmpty ? '' : ' · $where'}', style: text.bodyMedium?.copyWith(color: p.muted)),
      if (todo != null) ...[const SizedBox(height: 8), Text('${KpiWords.yourStep}: $todo', style: text.labelLarge)],
      if (v.card.practice) ...[const SizedBox(height: 14), const Notice(text: '${KpiWords.practiceBanner}. ${KpiWords.practiceNote}', ok: false)],
      if (_notice != null) ...[const SizedBox(height: 14), Notice(text: _notice!.text, ok: _notice!.ok)],
      const SizedBox(height: 18),
      _About(view: v),
      if (v.can.calibrate) ...[const SizedBox(height: 12), const Notice(text: KpiWords.calibrateOnWebsite, ok: true)],
      const SizedBox(height: 12),
      if (live != null)
        _ScoreCard(
          title: mode == KpiSheetMode.self ? KpiWords.yourSelfRating : KpiWords.yourScoring,
          score: live,
          notes: [
            KpiWords.workedOut,
            if (_unpicked(v).isNotEmpty) KpiWords.notPickedYet(_unpicked(v).length),
            if (live.capped) KpiWords.cappedNote,
            if (mode == KpiSheetMode.score && v.selfScore != null) KpiWords.selfLine(v.selfScore!),
            if (!v.attendance.counted) KpiWords.performanceOnly,
          ],
        )
      else
        _shownScore(v, own),
      for (final (i, pillar) in v.pillars.indexed) ...[
        const SizedBox(height: 12),
        _PillarCard(
          pillar: pillar,
          number: i + 1,
          view: v,
          score: shownPillars?.where((s) => s.key == pillar.key).firstOrNull,
          children: [
            for (final m in pillar.metrics)
              _MetricBlock(
                metric: m,
                mode: mode,
                pick: _picks[m.id],
                onPick: editing && _busy == null ? (c) => setState(() => _picks[m.id] = c) : null,
                note: _notes[m.id],
                noteOpen: _openNotes.contains(m.id),
                onOpenNote: () => setState(() => _openNotes.add(m.id)),
              ),
          ],
        ),
      ],
      if (editing) ...[const SizedBox(height: 12), _stepCard(context, v, mode)],
      if (v.can.signAsEmployee || v.can.signAsManager) ...[const SizedBox(height: 12), _signCard(context, v)],
      const SizedBox(height: 12),
      _CommentsCard(view: v, editing: mode),
      const SizedBox(height: 12),
      _StepsCard(view: v),
    ];
  }

  List<String> _unpicked(KpiScorecardView v) => [
    for (final m in v.metrics)
      if (_picks[m.id] == null) m.name,
  ];

  /// The score as it stands while nobody picks: the score that counts, else the self-rating, else none yet.
  Widget _shownScore(KpiScorecardView v, bool own) {
    final s = v.score;
    if (s != null) {
      return _ScoreCard(
        title: v.card.status == 'final' ? KpiWords.finalScore : KpiWords.scoreTitle,
        score: s,
        notes: [
          if (v.card.status == 'hr') KpiWords.managersBeforeHr,
          if (v.card.calibrated > 0) KpiWords.hrChanged(v.card.calibrated),
          if (s.capped) KpiWords.cappedNote,
          if (v.selfScore != null) KpiWords.selfLine(v.selfScore!),
          if (!v.attendance.counted) KpiWords.performanceOnly,
        ],
      );
    }
    if (v.selfScore != null) {
      return _ScoreCard(
        title: own ? KpiWords.yourSelfRating : KpiWords.selfRatingTitle,
        score: v.selfScore,
        notes: [own ? KpiWords.ownSelfNote : KpiWords.othersSelfNote, if (!v.attendance.counted) KpiWords.performanceOnly],
      );
    }
    return _ScoreCard(
      title: KpiWords.scoreTitle,
      score: null,
      notes: [own ? KpiWords.ownNoScore : KpiWords.notScoredYet, if (!v.attendance.counted) KpiWords.performanceOnly],
    );
  }

  /// The step's comment, where it stands, and Send / Save.
  Widget _stepCard(BuildContext context, KpiScorecardView v, KpiSheetMode mode) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final left = _unpicked(v);
    final today = isoDayOf(DateTime.now());
    // the scorer saves while the self-rating is open, and sends once it is in or its day has passed (the API's rule)
    final waitsForSelf = mode == KpiSheetMode.score && v.card.status == 'self_rating' && !v.card.practice && !(today.compareTo(v.deadlines.selfRating) > 0);
    final canSend = left.isEmpty && !waitsForSelf;
    final self = mode == KpiSheetMode.self;
    final status = waitsForSelf ? KpiWords.waitsForSelf(kpiDate(v.deadlines.selfRating)) : (left.isNotEmpty ? KpiWords.stillToPick(left) : KpiWords.readyToSend);
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: self ? KpiWords.commentSelfLabel : KpiWords.commentScoreLabel),
                TextSpan(text: ' ${self ? KpiWords.optional : KpiWords.neededToSend}', style: text.bodySmall),
              ],
            ),
            style: text.labelMedium,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _comment,
            minLines: 3,
            maxLines: 6,
            maxLength: kpiCommentMax,
            enabled: _busy == null,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(semanticCounterText: '', labelText: self ? KpiWords.commentSelfLabel : KpiWords.commentScoreLabel),
          ),
          Text('${self ? KpiWords.commentSelfHint : KpiWords.commentScoreHint} ${KpiWords.upTo(kpiCommentMax)}', style: text.bodySmall),
          const SizedBox(height: 14),
          Text(status, style: text.bodyMedium?.copyWith(color: canSend ? p.ink : p.muted)),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy == null && canSend ? () => _sendPicks(v, mode, submit: true) : null,
            child: Text(_busy == 'send' ? KpiWords.sending : (self ? KpiWords.sendSelf : KpiWords.sendScoring)),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _busy == null ? () => _sendPicks(v, mode, submit: false) : null,
            child: Text(_busy == 'save' ? KpiWords.saving : KpiWords.save),
          ),
        ],
      ),
    );
  }

  /// The sign-off: "I've read it", with an optional comment.
  Widget _signCard(BuildContext context, KpiScorecardView v) {
    final text = Theme.of(context).textTheme;
    final asEmployee = v.can.signAsEmployee;
    final note = v.card.practice ? 'A practice scorecard is final once both sides have signed: no day makes it final.' : KpiWords.signNote(kpiDate(v.deadlines.signOff));
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(asEmployee ? KpiWords.signYours : KpiWords.signAsManager, style: text.titleLarge),
          const SizedBox(height: 10),
          Text('${asEmployee ? KpiWords.signEmployeeText : KpiWords.signManagerText} $note', style: text.bodyMedium),
          const SizedBox(height: 14),
          TextField(
            controller: _signComment,
            minLines: 2,
            maxLines: 5,
            maxLength: kpiCommentMax,
            enabled: _busy == null,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: '${KpiWords.comment} ${KpiWords.optional}', semanticCounterText: ''),
          ),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy == null ? () => _sign(v) : null, child: Text(_busy == 'sign' ? KpiWords.signing : KpiWords.iveReadIt)),
        ],
      ),
    );
  }
}

// ---------- about ----------

class _About extends StatelessWidget {
  const _About({required this.view});

  final KpiScorecardView view;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final v = view;
    final now = stepDeadline(v.card.status, v.deadlines);
    final deadlines = [
      (label: 'Self-rating', date: v.deadlines.selfRating),
      (label: 'Scoring', date: v.deadlines.manager),
      // HR's only when HR calibrates: after a manager's scoring
      if (v.card.scorerKind == 'manager') (label: 'HR calibration', date: v.deadlines.hr),
      (label: 'Sign-off', date: v.deadlines.signOff),
    ];
    Widget fact(String label, List<Widget> value) => Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall),
          const SizedBox(height: 3),
          ...value,
        ],
      ),
    );
    Widget signedRow(bool done, String who) => Text(
      '${done ? '✓' : '○'} $who ${done ? 'signed' : 'not signed yet'}',
      style: text.bodyMedium?.copyWith(color: done ? p.ink : p.muted),
    );
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Eyebrow(KpiWords.about),
          fact(KpiWords.scoredBy, [Text(scorerText(v.card.scorerKind, v.card.scorerName), style: text.bodyLarge)]),
          fact(KpiWords.whereItStands, [
            Text(stepDeadlineText(v.card.status, v.deadlines) ?? KpiWords.finalAndLocked, style: text.bodyLarge),
            if (v.card.selfMissed) Text(KpiWords.selfMissed, style: text.bodySmall?.copyWith(color: p.danger)),
          ]),
          fact(KpiWords.deadlines, [
            for (final d in deadlines)
              Text(
                '${d.label} by ${kpiDate(d.date)}',
                style: d.date == now ? text.bodyMedium?.copyWith(fontWeight: FontWeight.w600) : text.bodyMedium?.copyWith(color: p.muted),
              ),
          ]),
          fact(KpiWords.template, [
            Text(KpiWords.version(v.card.templateVersion), style: text.bodyLarge),
            if (v.card.jobTitle != null) Text(v.card.jobTitle!, style: text.bodySmall),
          ]),
          fact(KpiWords.pay, [
            if (v.card.practice) ...[
              Text('Not counted', style: text.bodyLarge),
              Text('A practice scorecard never reaches payroll or the payslips.', style: text.bodySmall),
            ] else ...[
              Text(payrollText(v.payrollMonth), style: text.bodyLarge),
              Text(KpiWords.payNote, style: text.bodySmall),
            ],
          ]),
          if (v.card.status == 'sign_off' || v.card.status == 'final')
            fact(KpiWords.signatures, [
              signedRow(v.card.signedEmployee, 'The employee'),
              signedRow(v.card.signedManager, v.card.scorerKind == 'manager' ? 'The manager' : 'The scorer'),
              if (v.card.unsigned) Text('Final without every signature, by the sign-off day', style: text.bodySmall?.copyWith(color: p.danger)),
            ]),
        ],
      ),
    );
  }
}

// ---------- the score ----------

/// The final % big with its level, the lines that say whose score it is, and each pillar's %.
class _ScoreCard extends StatelessWidget {
  const _ScoreCard({required this.title, required this.score, required this.notes});

  final String title;
  final KpiScoreResult? score;
  final List<String> notes;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final s = score;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: text.titleLarge),
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 6,
              children: [
                Text(s == null ? '—' : kpiPercentText(s.finalPercent), style: text.displaySmall),
                if (s != null) Pill(s.levelLabel, strong: true),
              ],
            ),
          ),
          for (final n in notes) ...[const SizedBox(height: 4), Text(n, style: text.bodySmall)],
          if (s != null && s.pillars.isNotEmpty) ...[
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, box) {
                final width = (box.maxWidth - 8) / 2;
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final pl in s.pillars)
                      Container(
                        width: width,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusControl), border: Border.all(color: p.line)),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${pl.short} · ${oneDecimal(pl.weight)}%', style: text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 2),
                            Text(pl.leftOut ? '—' : kpiPercentText(pl.percent), style: text.titleLarge),
                            Text(pl.leftOut ? KpiWords.notScored : '${oneDecimal(pl.achieved)} / ${pointsText(pl.max)}', style: text.bodySmall),
                          ],
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}

// ---------- the pillars and metrics ----------

class _PillarCard extends StatelessWidget {
  const _PillarCard({required this.pillar, required this.number, required this.view, required this.score, required this.children});

  final KpiPillar pillar;
  final int number;
  final KpiScorecardView view;
  final KpiPillarScore? score;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    // the Attendance metric only while it counts (owner, 25 October 2026: "Fixed cut only")
    final attendance = pillar.key == view.attendancePillar && view.attendance.counted;
    final leftOut = score?.leftOut ?? pillar.leftOut;
    return SurfaceCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Eyebrow(KpiWords.pillarHead(number, pillar.weight)),
                      const SizedBox(height: 6),
                      Text(pillar.name, style: text.titleLarge),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(score != null && !leftOut ? kpiPercentText(score!.percent) : '—', style: text.headlineSmall),
                    Text(
                      leftOut ? KpiWords.notScored : (score != null ? '${oneDecimal(score!.achieved)} / ${pointsText(score!.max)}' : KpiWords.ofPoints(pillar.max)),
                      style: text.bodySmall,
                    ),
                  ],
                ),
              ],
            ),
          ),
          for (final child in children) ...[Divider(height: 1, color: p.line), child],
          if (attendance) ...[Divider(height: 1, color: p.line), _AttendanceBlock(view: view)],
          if (pillar.metrics.isEmpty && !attendance) ...[
            Divider(height: 1, color: p.line),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Text(leftOut ? KpiWords.leftOutText(pillar.weight) : KpiWords.noMetrics, style: text.bodySmall),
            ),
          ],
        ],
      ),
    );
  }
}

/// The automatic Attendance metric, read-only in its pillar.
class _AttendanceBlock extends StatelessWidget {
  const _AttendanceBlock({required this.view});

  final KpiScorecardView view;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final a = view.attendance;
    final t = attendanceText(a);
    return Container(
      color: context.palette.raised,
      padding: const EdgeInsets.all(20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [Text(KpiWords.attendanceMetric, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)), const _Tag(KpiWords.automatic)],
                ),
                const SizedBox(height: 4),
                Text(KpiWords.attendanceAbout, style: text.bodySmall),
                const SizedBox(height: 8),
                Text(t.detail, style: text.bodyMedium),
                Text(t.source, style: text.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _Points(points: a.achieved, of: a.points),
        ],
      ),
    );
  }
}

/// "35" over "of 40 pts".
class _Points extends StatelessWidget {
  const _Points({required this.points, required this.of});

  final double? points;
  final double of;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(points == null ? '—' : oneDecimal(points!), style: text.titleLarge),
        Text(KpiWords.ofPoints(of), style: text.bodySmall),
      ],
    );
  }
}

/// A small tag on a criterion: the target, or whose pick it was.
class _Tag extends StatelessWidget {
  const _Tag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(Tokens.radiusPill), border: Border.all(color: p.line)),
      child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

/// A metric: what it is, its criteria scale (the target marked; earlier picks tagged where the caller sees them), what
/// earlier steps said, and its points of its target. With [onPick], the scale is the caller's choice, with a comment.
class _MetricBlock extends StatelessWidget {
  const _MetricBlock({required this.metric, required this.mode, required this.pick, required this.onPick, required this.note, required this.noteOpen, required this.onOpenNote});

  final KpiMetric metric;
  final KpiSheetMode mode;
  final int? pick;
  final ValueChanged<int>? onPick;
  final TextEditingController? note;
  final bool noteOpen;
  final VoidCallback onOpenNote;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final m = metric;
    final target = targetIndex(m);
    final editing = mode != KpiSheetMode.view;
    final points = pick != null && pick! < m.criteria.length ? m.criteria[pick!].points : (editing ? null : m.points);
    final managerPick = m.manager?.choice;
    List<Widget> tags(int i) => [
      if (i == target) const _Tag(KpiWords.target),
      if (mode != KpiSheetMode.self && m.self?.choice == i) const _Tag(KpiWords.selfRating),
      if (mode == KpiSheetMode.view && m.hr?.choice != null && managerPick == i) const _Tag(KpiWords.managerTag),
    ];
    final earlier = [
      if (mode != KpiSheetMode.self && m.self != null && (m.self!.choice != null || m.self!.comment != null))
        (who: KpiWords.selfRating, pick: pickText(m, m.self!.choice), comment: m.self!.comment, warn: false),
      if (mode != KpiSheetMode.score && m.manager != null && (m.manager!.choice != null || m.manager!.comment != null))
        (who: KpiWords.managerTag, pick: pickText(m, m.manager!.choice), comment: m.manager!.comment, warn: false),
      if (m.hr?.choice != null) (who: KpiWords.calibratedByHr, pick: pickText(m, m.hr!.choice), comment: m.hr!.comment, warn: true),
    ];
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.name, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                    if (m.definition != null) ...[const SizedBox(height: 4), Text(m.definition!, style: text.bodySmall)],
                    if (m.howMeasured != null) ...[const SizedBox(height: 4), Text('${KpiWords.howMeasured} ${m.howMeasured}', style: text.bodySmall)],
                    if (m.duties.isNotEmpty) ...[const SizedBox(height: 4), Text('${KpiWords.measures} ${m.duties.join(' · ')}', style: text.bodySmall?.copyWith(color: p.ink))],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              _Points(points: points, of: m.targetPoints),
            ],
          ),
          const SizedBox(height: 12),
          if (editing) ...[
            Text(mode == KpiSheetMode.self ? KpiWords.pickHowYouDid : KpiWords.pickOne, style: text.bodySmall),
            const SizedBox(height: 6),
          ],
          for (final (i, c) in m.criteria.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _Criterion(label: c.label, points: c.points, chosen: pick == i, tags: tags(i), onTap: onPick == null ? null : () => onPick!(i), editing: editing),
            ),
          for (final e in earlier)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: '${e.who}: ', style: const TextStyle(fontWeight: FontWeight.w600)),
                    TextSpan(text: e.pick ?? KpiWords.notPicked),
                    if (e.comment != null) TextSpan(text: '\n“${e.comment}”', style: TextStyle(color: p.muted)),
                  ],
                ),
                style: text.bodyMedium?.copyWith(color: e.warn ? p.danger : p.ink),
              ),
            ),
          if (editing && note != null) ...[
            const SizedBox(height: 6),
            if (noteOpen)
              TextField(
                controller: note,
                minLines: 2,
                maxLines: 4,
                maxLength: kpiCommentMax,
                enabled: onPick != null,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(labelText: '${KpiWords.comment} ${KpiWords.optional}', semanticCounterText: ''),
              )
            else
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: onPick == null ? null : onOpenNote,
                  icon: Icon(CupertinoIcons.plus, size: 16, color: p.ink),
                  label: Text('${KpiWords.addComment} ${KpiWords.optional}', style: text.labelMedium),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// One criterion of a metric's scale: chosen or not, its tags and its points; a choice to tap while picking.
class _Criterion extends StatelessWidget {
  const _Criterion({required this.label, required this.points, required this.chosen, required this.tags, required this.onTap, required this.editing});

  final String label;
  final double points;
  final bool chosen;
  final List<Widget> tags;
  final VoidCallback? onTap;
  final bool editing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final body = Container(
      constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: chosen ? p.raised : p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: chosen ? p.primary : p.line, width: chosen ? 1.5 : 1),
      ),
      child: Row(
        children: [
          if (editing) ...[
            Icon(chosen ? CupertinoIcons.largecircle_fill_circle : CupertinoIcons.circle, size: 20, color: chosen ? p.primary : p.muted),
            const SizedBox(width: 10),
          ],
          // the tags under the words, so a phone's width always fits them
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: text.bodyMedium?.copyWith(fontWeight: chosen ? FontWeight.w600 : null)),
                if (tags.isNotEmpty) ...[const SizedBox(height: 4), Wrap(spacing: 4, runSpacing: 4, children: tags)],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(pointsText(points), style: text.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
    return Semantics(
      inMutuallyExclusiveGroup: editing,
      checked: editing ? chosen : null,
      selected: !editing && chosen,
      button: onTap != null,
      child: onTap == null
          ? body
          : Material(
              type: MaterialType.transparency,
              child: InkWell(onTap: onTap, borderRadius: BorderRadius.circular(Tokens.radiusControl), child: body),
            ),
    );
  }
}

// ---------- comments and steps ----------

class _CommentsCard extends StatelessWidget {
  const _CommentsCard({required this.view, required this.editing});

  final KpiScorecardView view;
  final KpiSheetMode editing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final c = view.comments;
    final rows = [
      (who: 'Self-rating', text: editing == KpiSheetMode.self ? null : c.self),
      (who: 'Manager', text: editing == KpiSheetMode.score ? null : c.manager),
      (who: 'HR', text: c.hr),
      (who: 'Employee’s sign-off', text: c.employeeSign),
      (who: 'Manager’s sign-off', text: c.managerSign),
    ].where((r) => r.text != null).toList();
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(KpiWords.comments, style: text.titleLarge),
          const SizedBox(height: 10),
          if (rows.isEmpty) Text(KpiWords.noComments, style: text.bodySmall),
          for (final r in rows) ...[
            Text(r.who, style: text.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text('“${r.text}”', style: text.bodyMedium),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class _StepsCard extends StatelessWidget {
  const _StepsCard({required this.view});

  final KpiScorecardView view;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(KpiWords.everyStep, style: text.titleLarge),
          const SizedBox(height: 10),
          if (view.steps.isEmpty) Text(KpiWords.noSteps, style: text.bodySmall),
          for (final s in view.steps)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Icon(
                      CupertinoIcons.circle_fill,
                      size: 9,
                      // a missed self-rating, a calibration, a final without every signature marked; the opening plain
                      color: s.kind == 'self_missed' || s.kind == 'calibrated' || s.kind == 'final_unsigned' ? p.danger : (s.kind == 'opened' ? p.line : p.ink),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(s.label, style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                        if (s.comment != null) Text('“${s.comment}”', style: text.bodyMedium),
                        Text([?s.by, kpiDateTime(s.at)].join(' · '), style: text.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
