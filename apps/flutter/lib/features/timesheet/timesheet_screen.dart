import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/timesheet.dart';
import '../../shell/app_shell.dart' show tabPagePadding;
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../requests/request_text.dart' show dayWords, todayIso, weekdayName, dmy, hoursShort;
import '../requests/sheet_parts.dart';
import 'timesheet_data.dart';
import 'timesheet_logic.dart';
import 'timesheet_words.dart';

// My timesheet in the app (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Only those HR
// switches on"): the week, Sunday to Saturday, with the one before and after; each day's lines (a client or a task, the
// hours, a note) and its hours; a line added, changed or removed in a sheet; Save, and Send for approval (saving first);
// where the week stands (waiting for whom, approved, rejected with why) and the earlier weeks not sent yet. Someone who
// doesn't log hours is told why. People checks every rule again.

class TimesheetScreen extends ConsumerStatefulWidget {
  const TimesheetScreen({super.key, this.week});

  /// Any day of the week to open; none: this week.
  final String? week;

  @override
  ConsumerState<TimesheetScreen> createState() => _TimesheetScreenState();
}

class _TimesheetScreenState extends ConsumerState<TimesheetScreen> {
  late String _week = weekOf(widget.week ?? todayIso());

  /// The lines as changed here, not saved yet; null while they are People's.
  List<TimesheetLine>? _edited;
  bool _busy = false;
  String? _notice;
  bool _noticeOk = true;

  void _goTo(String week) => setState(() {
    _week = week;
    _edited = null;
    _notice = null;
  });

  Future<void> _save(MyTimesheet t, {bool thenSend = false}) async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      if (_edited != null) await saveTimesheet(ref, _week, _edited!);
      if (thenSend) await submitTimesheet(ref, _week);
      if (!mounted) return;
      timesheetsChanged(ref);
      setState(() {
        _edited = null;
        _notice = thenSend ? TimesheetWords.sent : TimesheetWords.saved;
        _noticeOk = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notice = refusalOf(e).join(' ');
        _noticeOk = false;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _line(MyTimesheet t, List<TimesheetLine> lines, {required String date, int? index}) async {
    final result = await showDesignSheet<_LineResult>(
      context,
      eyebrow: dayWords(date),
      title: index == null ? TimesheetWords.newLine : TimesheetWords.editLine,
      icon: CupertinoIcons.clock,
      builder: (_) => _LineSheet(date: date, clients: t.clients, line: index == null ? null : lines[index], otherHours: dayHours(lines, date) - (index == null ? 0 : lines[index].hours)),
    );
    if (result == null || !mounted) return;
    final next = [...lines];
    if (index == null) {
      next.add(result.line!);
    } else if (result.remove) {
      next.removeAt(index);
    } else {
      next[index] = result.line!;
    }
    setState(() => _edited = next);
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final loaded = ref.watch(myTimesheetProvider(_week));
    final today = todayIso();
    final thisWeek = weekOf(today);
    return Scaffold(
      backgroundColor: p.canvas,
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _edited = null);
          ref.invalidate(myTimesheetProvider(_week));
          await ref.read(myTimesheetProvider(_week).future).then<void>((_) {}, onError: (_) {});
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
            const PageHead(eyebrow: TimesheetWords.eyebrow, title: TimesheetWords.title),
            const SizedBox(height: 16),
            _WeekBar(
              week: _week,
              onPrevious: _busy ? null : () => _goTo(weekShift(_week, -1)),
              onNext: _busy || _week.compareTo(thisWeek) >= 0 ? null : () => _goTo(weekShift(_week, 1)),
            ),
            const SizedBox(height: 16),
            ...switch (loaded) {
              AsyncValue(value: final MyTimesheet t) => _week == weekOf(t.weekStart) ? _body(t, today) : [const _Loading()],
              AsyncError(:final error) => [
                Notice(
                  text: error is ApiException ? error.message : TimesheetWords.notLoaded,
                  ok: false,
                  action: TimesheetWords.tryAgain,
                  onAction: () => ref.invalidate(myTimesheetProvider(_week)),
                ),
              ],
              _ => [const _Loading()],
            },
          ],
        ),
      ),
    );
  }

  List<Widget> _body(MyTimesheet t, String today) {
    final text = Theme.of(context).textTheme;
    final p = context.palette;
    if (t.refusal != null) return [Notice(text: t.refusal!, ok: false)];
    final lines = _edited ?? t.lines;
    final total = lines.fold<double>(0, (n, l) => n + l.hours);
    final editable = t.canEdit && !_busy;
    final dirty = _edited != null;
    return [
      if (t.unsent.isNotEmpty) ...[
        Notice(text: TimesheetWords.unsent(t.unsent), ok: false, action: TimesheetWords.openIt, onAction: () => _goTo(t.unsent.first)),
        const SizedBox(height: 12),
      ],
      SurfaceCard(
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(TimesheetWords.total(total), style: text.titleLarge),
                  const SizedBox(height: 4),
                  Text(_standing(t), style: text.bodySmall),
                ],
              ),
            ),
            if (t.status != null) Pill(TimesheetWords.status[t.status]!, strong: t.status == TimesheetStatus.approved),
          ],
        ),
      ),
      if (_notice != null) ...[const SizedBox(height: 12), Semantics(liveRegion: true, child: Notice(text: _notice!, ok: _noticeOk))],
      if (dirty) ...[const SizedBox(height: 12), Text(TimesheetWords.unsaved, style: text.bodySmall?.copyWith(color: p.danger))],
      for (final date in weekDays(_week)) ...[
        const SizedBox(height: 12),
        _DayCard(
          date: date,
          lines: [for (final (i, l) in lines.indexed) if (l.date == date) (i, l)],
          onAdd: editable && date.compareTo(today) <= 0 ? () => _line(t, lines, date: date) : null,
          onOpen: editable ? (i) => _line(t, lines, date: date, index: i) : null,
        ),
      ],
      if (t.canEdit) ...[
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: dirty && !_busy ? () => _save(t) : null,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                child: Text(_busy ? TimesheetWords.saving : TimesheetWords.save),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton(
                onPressed: !_busy && lines.isNotEmpty && (t.canSubmit || dirty) ? () => _save(t, thenSend: true) : null,
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
                child: Text(_busy ? TimesheetWords.sending : TimesheetWords.send),
              ),
            ),
          ],
        ),
      ],
    ];
  }

  String _standing(MyTimesheet t) => switch (t.status) {
    TimesheetStatus.submitted => TimesheetWords.waitingFor(t.approverName),
    TimesheetStatus.approved => TimesheetWords.approvedBy(t.decidedBy),
    TimesheetStatus.rejected => TimesheetWords.rejected(t.rejectReason),
    _ => TimesheetWords.status[TimesheetStatus.draft]!,
  };
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(40),
    child: Center(child: CircularProgressIndicator()),
  );
}

/// The week, with the one before and after.
class _WeekBar extends StatelessWidget {
  const _WeekBar({required this.week, required this.onPrevious, required this.onNext});

  final String week;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final days = weekDays(week);
    return Row(
      children: [
        IconButton(onPressed: onPrevious, tooltip: TimesheetWords.previousWeek, icon: const Icon(CupertinoIcons.chevron_left, size: 18)),
        Expanded(child: Text(TimesheetWords.week(days.first, days.last), textAlign: TextAlign.center, style: Theme.of(context).textTheme.labelLarge)),
        IconButton(onPressed: onNext, tooltip: TimesheetWords.nextWeek, icon: const Icon(CupertinoIcons.chevron_right, size: 18)),
      ],
    );
  }
}

/// A day: its name and hours, its lines (tap to change), Add hours.
class _DayCard extends StatelessWidget {
  const _DayCard({required this.date, required this.lines, required this.onAdd, required this.onOpen});

  final String date;
  final List<(int, TimesheetLine)> lines;
  final VoidCallback? onAdd;
  final void Function(int index)? onOpen;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final hours = lines.fold<double>(0, (n, l) => n + l.$2.hours);
    return SurfaceCard(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('${weekdayName(date)} ${dmy(date)}', style: text.labelLarge)),
              Text(hours == 0 ? '—' : hoursShort(hours), style: text.labelMedium),
            ],
          ),
          for (final (i, l) in lines)
            InkWell(
              onTap: onOpen == null ? null : () => onOpen!(i),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
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
                    const SizedBox(width: 8),
                    Text(hoursShort(l.hours), style: text.bodyMedium),
                  ],
                ),
              ),
            ),
          if (lines.isEmpty && onAdd == null) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(TimesheetWords.noLines, style: text.bodySmall?.copyWith(color: p.muted))),
          if (onAdd != null)
            Align(
              alignment: Alignment.centerLeft,
              // keyed by the day: found by its date, whichever day of the week it is
              child: TextButton.icon(
                key: ValueKey('add:$date'),
                onPressed: onAdd,
                icon: const Icon(CupertinoIcons.add, size: 16),
                label: const Text(TimesheetWords.addLine),
              ),
            ),
        ],
      ),
    );
  }
}

/// What the line's sheet comes to: a line kept, or the line removed.
class _LineResult {
  const _LineResult.keep(this.line) : remove = false;
  const _LineResult.removed() : line = null, remove = true;

  final TimesheetLine? line;
  final bool remove;
}

/// A line: the client (theirs first) or the task, the hours, a note; Keep, and Remove for one already there.
class _LineSheet extends StatefulWidget {
  const _LineSheet({required this.date, required this.clients, required this.line, required this.otherHours});

  final String date;
  final List<TimesheetClient> clients;
  final TimesheetLine? line;
  final double otherHours;

  @override
  State<_LineSheet> createState() => _LineSheetState();
}

class _LineSheetState extends State<_LineSheet> {
  late String? _client = widget.line?.clientId;
  late final _task = TextEditingController(text: widget.line?.task ?? '');
  late final _hours = TextEditingController(text: widget.line == null ? '' : hoursShort(widget.line!.hours).split(' ').first);
  late final _note = TextEditingController(text: widget.line?.note ?? '');
  bool _tried = false;

  @override
  void dispose() {
    _task.dispose();
    _hours.dispose();
    _note.dispose();
    super.dispose();
  }

  List<String> get _problems =>
      lineProblems(clientId: _client, task: _task.text, hours: hoursOf(_hours.text), date: widget.date, today: todayIso(), otherHoursThatDay: widget.otherHours);

  void _keep() {
    setState(() => _tried = true);
    if (_problems.isNotEmpty) return;
    final client = widget.clients.where((c) => c.id == _client).firstOrNull;
    Navigator.of(context).pop(
      _LineResult.keep(
        TimesheetLine(
          date: widget.date,
          hours: hoursOf(_hours.text)!,
          clientId: client?.id,
          clientName: client?.name,
          task: _task.text.trim().isEmpty ? null : _task.text.trim(),
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    // a client no longer listed (ended since): still shown on its line
    final listed = widget.clients.any((c) => c.id == _client);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: TimesheetWords.client,
          optional: true,
          child: PickListField<String?>(
            label: TimesheetWords.client,
            value: listed ? _client : null,
            placeholder: TimesheetWords.pickClient,
            items: [
              (null, TimesheetWords.noClient),
              for (final c in widget.clients) (c.id, c.assigned ? '${c.name} · ${TimesheetWords.yours}' : c.name),
            ],
            onChanged: (v) => setState(() => _client = v),
          ),
        ),
        SheetField(
          label: TimesheetWords.task,
          optional: true,
          child: SheetTextBox(controller: _task, label: TimesheetWords.task, hint: TimesheetWords.taskHint, max: 200, onChanged: (_) => setState(() {})),
        ),
        SheetField(
          label: TimesheetWords.hours,
          child: SheetTextBox(
            controller: _hours,
            label: TimesheetWords.hours,
            hint: TimesheetWords.hoursHint,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
          ),
        ),
        SheetField(
          label: TimesheetWords.note,
          optional: true,
          child: SheetTextBox(controller: _note, label: TimesheetWords.note, lines: 2, max: 500),
        ),
        if (_tried) SendChecks(problems: _problems),
        if (widget.line != null) ...[
          OutlinedButton(
            onPressed: () => Navigator.of(context).pop(const _LineResult.removed()),
            style: OutlinedButton.styleFrom(foregroundColor: p.danger, side: BorderSide(color: p.danger.withValues(alpha: 0.5)), minimumSize: const Size.fromHeight(Tokens.tapTarget)),
            child: const Text(TimesheetWords.remove),
          ),
          const SizedBox(height: 10),
        ],
        SheetButtons(onSend: _keep, sendLabel: TimesheetWords.keep),
      ],
    );
  }
}
