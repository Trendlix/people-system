import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../format.dart';
import '../../models/interview_hours.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'account_screens.dart';
import 'profile_data.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Your Interview Hours (the phone design; apps/web account/interview-hours; owner, 25 October 2026: "Hours + calendar"):
// for each weekday the ranges one interviews in (Cairo time, on the quarter hour; add or remove), the day they count
// from, the minimum notice and buffer (the company's, or stricter), the one-off changes (a day off, extra hours on a
// date), then Save (PUT /api/me/interview-hours: an empty week with no changes clears them). People takes away one's
// leave, holidays, booked interviews and busy calendar by itself, and checks every value again, its refusals in its
// words. Below: how one's calendar is read (connecting one is done on the website: it signs in to Zoho, Google or
// Microsoft), and one's interviews to come.

/// What the form holds until it is saved.
class _Draft {
  _Draft.of(MyInterviewHours view)
    : windows = [...?view.hours?.windows],
      changes = [...?view.hours?.changes],
      effectiveFrom = view.hours?.effectiveFrom.isNotEmpty == true ? view.hours!.effectiveFrom : isoDayOf(DateTime.now()),
      notice = view.hours?.noticeHours,
      buffer = view.hours?.bufferMinutes;

  final List<WeeklyWindow> windows;
  final List<HoursChange> changes;
  String effectiveFrom;
  int? notice;
  int? buffer;

  InterviewHours get hours => InterviewHours(windows: windows, changes: changes, effectiveFrom: effectiveFrom, noticeHours: notice, bufferMinutes: buffer);
}

class InterviewHoursScreen extends ConsumerStatefulWidget {
  const InterviewHoursScreen({super.key});

  @override
  ConsumerState<InterviewHoursScreen> createState() => _InterviewHoursScreenState();
}

class _InterviewHoursScreenState extends ConsumerState<InterviewHoursScreen> {
  _Draft? _draft;

  /// The answer the form was filled from: a newer one refills it unless something was changed since.
  MyInterviewHours? _from;
  var _dirty = false;
  var _busy = false;
  ({String text, bool ok})? _said;

  void _edit(void Function(_Draft d) change) => setState(() {
    change(_draft!);
    _dirty = true;
    _said = null;
  });

  Future<void> _save() async {
    final d = _draft;
    if (d == null) return;
    setState(() {
      _busy = true;
      _said = null;
    });
    try {
      final saved = MyInterviewHours.fromJson(await ref.read(peopleClientProvider).put('/api/me/interview-hours', d.hours.toJson()));
      _dirty = false;
      ref.invalidate(myInterviewHoursProvider);
      if (mounted) setState(() => _said = (text: saved.hours == null ? AccountWords.cleared : AccountWords.saved, ok: true));
    } on Object catch (e) {
      if (mounted) setState(() => _said = (text: wordsOf(e), ok: false));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final loaded = ref.watch(myInterviewHoursProvider);
    final view = loaded.value;
    if (view != null && (_draft == null || (!_dirty && !identical(view, _from)))) {
      _draft = _Draft.of(view);
      _from = view;
    }
    return AccountPage(
      eyebrow: AccountWords.availabilityEyebrow,
      title: AccountWords.hoursTitle,
      intro: AccountWords.hoursIntro,
      // what was changed and not saved stays: only an untouched form is read again
      onRefresh: () async {
        ref.invalidate(myCalendarsProvider);
        if (_dirty) return;
        ref.invalidate(myInterviewHoursProvider);
        try {
          await ref.read(myInterviewHoursProvider.future);
        } on Object {
          // shown in its card, with Try again
        }
      },
      children: [
        ...switch (loaded) {
          AsyncValue(value: final MyInterviewHours v) => [
            if (v.needsHours && v.hours == null) const Notice(text: AccountWords.needsHours, ok: true),
            _hoursCard(v, _draft!),
            const _CalendarCard(),
            _UpcomingCard(rows: v.upcoming),
          ],
          AsyncError(:final error) => [LoadFailed(error: error, onRetry: () => ref.invalidate(myInterviewHoursProvider))],
          _ => [const CardLoading()],
        },
      ],
    );
  }

  Widget _hoursCard(MyInterviewHours v, _Draft d) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final activeDays = {for (final w in d.windows) w.day}.length;
    final said = _said;
    final saved = v.hours;
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
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
                    const Eyebrow(AccountWords.weeklySchedule),
                    const SizedBox(height: 5),
                    Semantics(header: true, child: Text(AccountWords.weeklyHours, style: _title22(text))),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Pill(AccountWords.activeDays(activeDays)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            saved == null
                ? AccountWords.noneYet(rulesText(null, null, v.defaults))
                : AccountWords.inEffect(rulesText(saved.noticeHours, saved.bufferMinutes, v.defaults)),
            style: text.bodySmall,
          ),
          const SizedBox(height: 18),
          for (var day = 0; day < 7; day++) _dayRow(day, d),
          Container(height: 1, color: p.line),
          const SizedBox(height: 24),
          _label(AccountWords.countsFrom),
          _DateBox(
            day: d.effectiveFrom,
            label: AccountWords.countsFrom,
            enabled: !_busy,
            onPicked: (day) => _edit((d) => d.effectiveFrom = day),
            first: DateTime(2020),
          ),
          _hint(AccountWords.countsFromHint),
          const SizedBox(height: 10),
          _label(AccountWords.minimumNotice),
          _ChoiceBox(
            label: AccountWords.minimumNotice,
            options: noticeOptions(v.defaults, d.notice),
            value: d.notice,
            enabled: !_busy,
            onChanged: (n) => _edit((d) => d.notice = n),
          ),
          _hint(AccountWords.noticeHint),
          const SizedBox(height: 10),
          _label(AccountWords.buffer),
          _ChoiceBox(
            label: AccountWords.buffer,
            options: bufferOptions(v.defaults, d.buffer),
            value: d.buffer,
            enabled: !_busy,
            onChanged: (n) => _edit((d) => d.buffer = n),
          ),
          _hint(AccountWords.bufferHint),
          const SizedBox(height: 25),
          Container(height: 1, color: p.line),
          const SizedBox(height: 20),
          Semantics(header: true, child: Text(AccountWords.oneOff, style: text.labelMedium?.copyWith(height: 1.5))),
          const SizedBox(height: 5),
          Text(AccountWords.oneOffHint, style: text.bodySmall),
          const SizedBox(height: 12),
          for (final (i, c) in d.changes.indexed) _changeRow(i, c),
          if (d.changes.length < HoursLimits.changes)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                QuietButton(AccountWords.addDayOff, onPressed: _busy ? null : _addDayOff),
                QuietButton(AccountWords.addExtra, onPressed: _busy ? null : _addExtra),
              ],
            ),
          const SizedBox(height: 20),
          Align(
            alignment: Alignment.centerLeft,
            child: SolidButton(_busy ? AccountWords.saving : AccountWords.save, busy: _busy, onPressed: _save),
          ),
          if (said != null) ...[const SizedBox(height: 14), Notice(text: said.text, ok: said.ok)],
          if (v.updatedAt != null) ...[const SizedBox(height: 12), Text(AccountWords.lastSaved(momentOf(v.updatedAt!), v.updatedBy), style: text.bodySmall)],
        ],
      ),
    );
  }

  Widget _label(String s) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(s, style: Theme.of(context).textTheme.labelMedium?.copyWith(height: 1.5)),
  );

  Widget _hint(String s) => Padding(
    padding: const EdgeInsets.only(top: 6, bottom: 4),
    child: Text(s, style: Theme.of(context).textTheme.bodySmall),
  );

  Widget _dayRow(int day, _Draft d) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final name = weekdayNames[day];
    final ranges = [
      for (final (i, w) in d.windows.indexed)
        if (w.day == day) (i, w),
    ]..sort((a, b) => a.$2.from.compareTo(b.$2.from));
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: p.line)),
      ),
      padding: const EdgeInsets.only(top: 10, bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 87,
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Semantics(header: true, child: Text(name, style: text.labelMedium?.copyWith(height: 1.5))),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (ranges.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(AccountWords.noInterviews, style: text.bodySmall),
                  )
                else
                  for (final (i, w) in ranges)
                    Row(
                      children: [
                        Expanded(child: Text(rangeText(w.from, w.to), style: text.labelMedium?.copyWith(height: 1.5))),
                        IconButton(
                          tooltip: AccountWords.removeRange(name, rangeText(w.from, w.to)),
                          onPressed: _busy ? null : () => _edit((d) => d.windows.removeAt(i)),
                          icon: Icon(CupertinoIcons.xmark, size: 16, color: p.muted),
                        ),
                      ],
                    ),
                if (ranges.length < HoursLimits.rangesPerDay)
                  TextButton(
                    onPressed: _busy ? null : () => _addRange(day),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget),
                      alignment: Alignment.centerLeft,
                      textStyle: text.labelMedium,
                    ),
                    child: Text(AccountWords.addRange, semanticsLabel: AccountWords.addRangeOn(name)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _changeRow(int i, HoursChange c) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final what = c.kind == 'off' ? AccountWords.dayOff : AccountWords.extraHours;
    final when = [shortDateOf(c.date), if (c.kind == 'extra' && c.from != null && c.to != null) rangeText(c.from!, c.to!)].join(' · ');
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        color: p.raised,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: p.line),
      ),
      child: Row(
        children: [
          Expanded(
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(what, style: text.labelMedium?.copyWith(height: 1.5)),
                  Text(when, style: text.bodySmall),
                ],
              ),
            ),
          ),
          IconButton(
            tooltip: '${AccountWords.remove} $what, $when',
            onPressed: _busy ? null : () => _edit((d) => d.changes.removeAt(i)),
            icon: Icon(CupertinoIcons.xmark, size: 16, color: p.muted),
          ),
        ],
      ),
    );
  }

  Future<void> _addRange(int day) async {
    final range = await showDesignSheet<(String, String)>(
      overAll(context),
      eyebrow: weekdayNames[day],
      title: AccountWords.addRange,
      builder: (context) => const _RangeForm(),
    );
    if (range != null) _edit((d) => d.windows.add((day: day, from: range.$1, to: range.$2)));
  }

  Future<void> _addDayOff() async {
    final day = await _pickDay(context, AccountWords.dayOff);
    if (day != null) _edit((d) => d.changes.add((date: day, kind: 'off', from: null, to: null)));
  }

  Future<void> _addExtra() async {
    final extra = await showDesignSheet<(String, String, String)>(
      overAll(context),
      eyebrow: AccountWords.oneOff,
      title: AccountWords.extraHours,
      builder: (context) => const _RangeForm(withDate: true),
    );
    if (extra != null) _edit((d) => d.changes.add((date: extra.$1, kind: 'extra', from: extra.$2, to: extra.$3)));
  }
}

TextStyle? _title22(TextTheme text) => text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.88);

/// 27/10/2026, as the website's date fields write a day.
String _ddmmyyyy(String iso) => iso.length >= 10 ? '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}' : iso;

/// A day chosen on the phone's calendar, from today on (a one-off change ahead), as YYYY-MM-DD.
Future<String?> _pickDay(BuildContext context, String help, {String? initial, DateTime? first}) async {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final from = first ?? today;
  var start = DateTime.tryParse(initial ?? '') ?? today;
  if (start.isBefore(from)) start = from;
  final picked = await showDatePicker(context: context, initialDate: start, firstDate: from, lastDate: today.add(const Duration(days: 366)), helpText: help);
  return picked == null ? null : isoDayOf(picked);
}

/// A day's field: the day as DD/MM/YYYY and the calendar's icon; a tap opens the phone's calendar.
class _DateBox extends StatelessWidget {
  const _DateBox({required this.day, required this.label, required this.enabled, required this.onPicked, this.first});

  final String? day;
  final String label;
  final bool enabled;
  final ValueChanged<String> onPicked;
  final DateTime? first;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final d = day;
    Future<void> pick() async {
      final picked = await _pickDay(context, label, initial: d, first: first);
      if (picked != null) onPicked(picked);
    }

    return Semantics(
      button: true,
      label: label,
      value: d == null ? null : shortDateOf(d),
      excludeSemantics: true,
      onTap: enabled ? pick : null,
      child: InkWell(
        onTap: enabled ? pick : null,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
          padding: const EdgeInsets.symmetric(horizontal: 11),
          decoration: BoxDecoration(
            color: p.raised,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: p.line),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(d == null ? ChangeWords.pickDate : _ddmmyyyy(d), style: text.labelMedium?.copyWith(color: d == null ? p.muted : p.ink)),
              ),
              Icon(CupertinoIcons.calendar, size: 18, color: p.ink),
            ],
          ),
        ),
      ),
    );
  }
}

/// A list's field (the notice, the buffer, a time): the chosen one's words, the list below it.
class _ChoiceBox<T> extends StatelessWidget {
  const _ChoiceBox({required this.label, required this.options, required this.value, required this.enabled, required this.onChanged});

  final String label;
  final List<({T value, String label})> options;
  final T value;
  final bool enabled;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: BorderSide(color: p.line),
    );
    return DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      style: text.labelMedium,
      icon: Icon(CupertinoIcons.chevron_down, size: 14, color: p.ink),
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(horizontal: 11, vertical: 12),
        border: border,
        enabledBorder: border,
        disabledBorder: border,
      ),
      items: [for (final o in options) DropdownMenuItem<T>(value: o.value, child: Text(o.label))],
      onChanged: enabled ? (v) => onChanged(v as T) : null,
    );
  }
}

/// A range to add: its start and end on the quarter hour, and (extra hours) its date. Pops (from, to) or (date, from, to).
class _RangeForm extends StatefulWidget {
  const _RangeForm({this.withDate = false});

  final bool withDate;

  @override
  State<_RangeForm> createState() => _RangeFormState();
}

class _RangeFormState extends State<_RangeForm> {
  String? _date;
  String? _from;
  String? _to;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final times = [for (final t in quarterHours) (value: t as String?, label: clock12(t))];
    final ready = _from != null && _to != null && (!widget.withDate || _date != null);
    Widget label(String s) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(s, style: text.labelMedium?.copyWith(height: 1.5)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.withDate) ...[
          label(AccountWords.date),
          _DateBox(day: _date, label: AccountWords.date, enabled: true, onPicked: (d) => setState(() => _date = d)),
          const SizedBox(height: 16),
        ],
        label(AccountWords.from),
        _ChoiceBox<String?>(
          label: AccountWords.from,
          options: [(value: null, label: ChangeWords.choose), ...times],
          value: _from,
          enabled: true,
          onChanged: (v) => setState(() => _from = v),
        ),
        const SizedBox(height: 16),
        label(AccountWords.to),
        _ChoiceBox<String?>(
          label: AccountWords.to,
          options: [(value: null, label: ChangeWords.choose), ...times],
          value: _to,
          enabled: true,
          onChanged: (v) => setState(() => _to = v),
        ),
        const SizedBox(height: 22),
        FilledButton(
          onPressed: !ready ? null : () => Navigator.of(context).pop(widget.withDate ? (_date!, _from!, _to!) : (_from!, _to!)),
          child: const Text(AccountWords.add),
        ),
      ],
    );
  }
}

// ---------- the calendar and what is to come ----------

class _CalendarCard extends ConsumerWidget {
  const _CalendarCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final loaded = ref.watch(myCalendarsProvider);
    final (String title, String line) = switch (loaded) {
      AsyncValue(value: final MyCalendars c) => _calendarWords(c),
      AsyncError(:final error) => (AccountWords.calendarNotLoaded, wordsOf(error)),
      _ => ('…', ''),
    };
    return SurfaceCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const IconTile(CupertinoIcons.calendar),
          const SizedBox(height: 20),
          const Eyebrow(AccountWords.yourCalendar),
          const SizedBox(height: 6),
          Text(title, style: text.titleMedium?.copyWith(fontSize: 18, letterSpacing: -0.2)),
          if (line.isNotEmpty) ...[const SizedBox(height: 8), Text(line, style: text.bodySmall)],
        ],
      ),
    );
  }

  (String, String) _calendarWords(MyCalendars c) {
    final broken = c.connected.where((l) => !l.working).toList();
    if (broken.isNotEmpty) {
      final name = calendarLabels[broken.first.provider] ?? broken.first.provider;
      return (AccountWords.needsReconnecting(name), AccountWords.reconnectOnWebsite);
    }
    if (c.connected.isNotEmpty) {
      final l = c.connected.first;
      return (AccountWords.connected(calendarLabels[l.provider] ?? l.provider), AccountWords.connectedAs(l.account));
    }
    if (c.companyZoho) return (AccountWords.companyReads(calendarLabels['zoho']!), AccountWords.companyReadsLine(c.workEmail));
    if (c.companyMicrosoft) return (AccountWords.companyReads(calendarLabels['microsoft']!), AccountWords.companyReadsLine(c.workEmail));
    return (AccountWords.noCalendar, AccountWords.noCalendarLine);
  }
}

class _UpcomingCard extends StatelessWidget {
  const _UpcomingCard({required this.rows});

  final List<UpcomingInterview> rows;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Align(alignment: Alignment.centerLeft, child: IconTile(CupertinoIcons.person_2)),
          const SizedBox(height: 20),
          const Eyebrow(AccountWords.comingUp),
          const SizedBox(height: 6),
          Semantics(header: true, child: Text(AccountWords.upcoming, style: text.titleMedium?.copyWith(fontSize: 18, letterSpacing: -0.2))),
          const SizedBox(height: 8),
          if (rows.isEmpty)
            Text(AccountWords.noUpcoming, style: text.bodySmall)
          else
            for (final i in rows)
              RecordRow(
                icon: CupertinoIcons.person,
                title: [i.candidate, if (i.job.isNotEmpty) i.job].join(' · '),
                subtitle: AccountWords.interviewLine(i.startsAt == null ? '—' : momentOf(i.startsAt!), i.minutes, interviewKindLabels[i.kind] ?? i.kind),
              ),
        ],
      ),
    );
  }
}
