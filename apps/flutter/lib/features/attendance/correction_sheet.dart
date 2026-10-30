import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../format.dart';
import '../../models/attendance_correction.dart';
import '../../models/my_attendance.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'attendance_data.dart';
import 'attendance_logic.dart';
import 'attendance_words.dart';

/// Ask for a correction, in the design's bottom sheet (the website's form, attendance/corrections/correction-form.tsx):
/// the day (of the month shown, gone by or today), what is on record for it, what was wrong, the right times the kind
/// asks for, and why. People's checks show as they apply, Send staying off while any is left; People checks it all again
/// when it is sent and its refusal shows in its words. Once sent, the correction People made of it.
Future<AttendanceCorrection?> showCorrectionSheet(BuildContext context, {required MyMonth month, required String today, String? date}) {
  // over the tab bar, as the design's sheets are
  final root = Navigator.of(context, rootNavigator: true).context;
  return showDesignSheet<AttendanceCorrection>(
    root,
    eyebrow: AttendanceWords.newRequest,
    title: AttendanceWords.askCorrection,
    icon: CupertinoIcons.clock,
    intro: AttendanceWords.correctionIntro,
    builder: (context) => CorrectionForm(month: month, today: today, date: date),
  );
}

class CorrectionForm extends ConsumerStatefulWidget {
  const CorrectionForm({super.key, required this.month, required this.today, this.date});

  final MyMonth month;
  final String today;

  /// The day chosen already (from its details), YYYY-MM-DD.
  final String? date;

  @override
  ConsumerState<CorrectionForm> createState() => _CorrectionFormState();
}

class _CorrectionFormState extends ConsumerState<CorrectionForm> {
  String? _date;
  String? _kind;
  String? _in;
  String? _out;
  final _reason = TextEditingController();
  var _sending = false;
  List<String>? _refused;

  /// The days that can be chosen: the month's, up to today.
  ({DateTime first, DateTime last}) get _range {
    final b = monthBounds(widget.month.month);
    final last = b.last.compareTo(widget.today) > 0 ? widget.today : b.last;
    return (first: DateTime.parse(b.first), last: DateTime.parse(last));
  }

  @override
  void initState() {
    super.initState();
    final d = widget.date;
    if (d != null && d.startsWith(widget.month.month) && d.compareTo(widget.today) <= 0) _date = d;
    _reason.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickDay() async {
    final r = _range;
    final picked = await showDatePicker(
      context: context,
      firstDate: r.first,
      lastDate: r.last,
      initialDate: _date == null ? r.last : DateTime.parse(_date!),
      helpText: AttendanceWords.chooseDay,
    );
    if (picked != null && mounted) setState(() => _date = isoDayOf(picked));
  }

  Future<void> _pickTime(bool checkIn) async {
    final day = _date == null ? null : widget.month.dayOn(_date!);
    final current = checkIn ? _in : _out;
    final onRecord = checkIn ? day?.checkIn : day?.checkOut;
    final initial = current != null
        ? TimeOfDay(hour: int.parse(current.substring(0, 2)), minute: int.parse(current.substring(3, 5)))
        : onRecord != null
        ? TimeOfDay.fromDateTime(onRecord.toLocal())
        : TimeOfDay(hour: checkIn ? 9 : 18, minute: 0);
    final picked = await showTimePicker(context: context, initialTime: initial, helpText: checkIn ? AttendanceWords.cameInAt : AttendanceWords.leftAt);
    if (picked == null || !mounted) return;
    final hhmm = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
    setState(() => checkIn ? _in = hhmm : _out = hhmm);
  }

  TypedCorrection get _typed {
    final needs = timesNeeded(_kind, _date == null ? null : widget.month.dayOn(_date!));
    return (
      date: _date,
      kind: _kind,
      checkIn: needs.checkIn == TimeNeed.none ? null : _in,
      checkOut: needs.checkOut == TimeNeed.none ? null : _out,
      reason: _reason.text,
    );
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _refused = null;
    });
    try {
      final made = await askForCorrection(ref, correctionBody(_typed));
      if (mounted) Navigator.of(context).pop(made);
    } on ApiException catch (e) {
      if (mounted) setState(() => _refused = e.messages);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final m = widget.month;
    final day = _date == null ? null : m.dayOn(_date!);
    final needs = timesNeeded(_kind, day);
    final problems = correctionProblems(_typed, m, today: widget.today, now: ref.read(attendanceClockProvider)());
    final blocked = problems.isNotEmpty || _sending;
    final muted = text.bodySmall;

    Widget label(String words, {bool optional = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: words),
            if (optional) TextSpan(text: ' ${AttendanceWords.optional}', style: TextStyle(color: p.muted)),
          ],
        ),
        style: text.labelMedium,
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        label(AttendanceWords.day),
        _FieldButton(text: _date == null ? AttendanceWords.chooseDay : AttendanceWords.dayTitle(_date!), placeholder: _date == null, icon: CupertinoIcons.calendar, onTap: _pickDay),
        const SizedBox(height: 6),
        Text(AttendanceWords.dayHint, style: muted),
        if (_date != null) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusControl), border: Border.all(color: p.line)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(AttendanceWords.onRecordFor(AttendanceWords.dayTitle(_date!)), style: muted),
                  const SizedBox(height: 2),
                  Text(
                    onRecordText(known: day != null, status: day?.status, checkIn: day?.checkIn, checkOut: day?.checkOut),
                    style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
                  ),
                  if (day != null) Text(AttendanceWords.sourceOf(day.source), style: muted),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 22),
        label(AttendanceWords.whatWasWrong),
        for (final k in correctionKinds) _Choice(label: AttendanceWords.kinds[k]!, selected: _kind == k, onTap: () => setState(() => _kind = k)),
        if (needs.checkIn != TimeNeed.none) ...[
          const SizedBox(height: 18),
          label(_kind == 'worked_remotely' ? AttendanceWords.startedAt : AttendanceWords.cameInAt, optional: needs.checkIn == TimeNeed.optional),
          _TimeField(value: _in, what: AttendanceWords.cameInAt, onTap: () => _pickTime(true), onClear: () => setState(() => _in = null)),
        ],
        if (needs.checkOut != TimeNeed.none) ...[
          const SizedBox(height: 18),
          label(AttendanceWords.leftAt, optional: needs.checkOut == TimeNeed.optional),
          _TimeField(value: _out, what: AttendanceWords.leftAt, onTap: () => _pickTime(false), onClear: () => setState(() => _out = null)),
        ],
        const SizedBox(height: 6),
        Text(AttendanceWords.timesHint, style: muted),
        const SizedBox(height: 22),
        label(AttendanceWords.why),
        TextField(
          controller: _reason,
          minLines: 3,
          maxLines: 6,
          maxLength: correctionReasonMax,
          textCapitalization: TextCapitalization.sentences,
          style: text.bodyLarge,
          decoration: const InputDecoration(hintText: AttendanceWords.whyHint, hintMaxLines: 3),
        ),
        const SizedBox(height: 12),
        Semantics(
          liveRegion: true,
          child: problems.isEmpty
              ? Text(AttendanceWords.ready(_kind!, AttendanceWords.dayTitle(_date!)), style: text.bodyMedium)
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusControl), border: Border.all(color: p.line)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(AttendanceWords.beforeSend, style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w500)),
                      for (final problem in problems)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('·  $problem', style: text.bodyMedium?.copyWith(color: p.muted)),
                        ),
                    ],
                  ),
                ),
        ),
        if (_refused != null) ...[const SizedBox(height: 12), Notice(text: _refused!.join('\n'), ok: false)],
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _sending ? null : () => Navigator.of(context).pop(),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48), textStyle: text.labelMedium),
                child: const Text(AttendanceWords.cancel),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                onPressed: blocked ? null : _send,
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48), textStyle: text.labelMedium),
                child: Text(_sending ? AttendanceWords.sending : AttendanceWords.send),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// A field that opens a picker (the day, a time): what is chosen, or what to choose.
class _FieldButton extends StatelessWidget {
  const _FieldButton({required this.text, required this.placeholder, required this.icon, required this.onTap, this.trailing});

  final String text;
  final bool placeholder;
  final IconData icon;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final style = Theme.of(context).textTheme.bodyLarge;
    final radius = BorderRadius.circular(Tokens.radiusControl);
    return Material(
      color: p.raised,
      shape: RoundedRectangleBorder(borderRadius: radius, side: BorderSide(color: p.line)),
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
          child: Padding(
            padding: const EdgeInsets.only(left: 14),
            child: Row(
              children: [
                Icon(icon, size: 18, color: p.muted),
                const SizedBox(width: 10),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(text, style: style?.copyWith(color: placeholder ? p.muted : p.ink)),
                  ),
                ),
                ?trailing,
                if (trailing == null) const SizedBox(width: 14),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({required this.value, required this.what, required this.onTap, required this.onClear});

  final String? value;
  final String what;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      label: what,
      child: _FieldButton(
        text: value ?? AttendanceWords.chooseTime,
        placeholder: value == null,
        icon: CupertinoIcons.clock,
        onTap: onTap,
        trailing: value == null
            ? null
            : IconButton(
                tooltip: AttendanceWords.clear(what.toLowerCase()),
                onPressed: onClear,
                icon: Icon(CupertinoIcons.xmark_circle, size: 18, color: p.muted),
              ),
      ),
    );
  }
}

/// One of what was wrong: a row with its mark, the chosen one filled.
class _Choice extends StatelessWidget {
  const _Choice({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
          child: Row(
            children: [
              Container(
                width: 20,
                height: 20,
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: selected ? p.ink : p.line, width: 1.5)),
                child: selected ? DecoratedBox(decoration: BoxDecoration(shape: BoxShape.circle, color: p.ink)) : null,
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(label, style: text.bodyLarge)),
            ],
          ),
        ),
      ),
    );
  }
}
