import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../format.dart';
import '../../models/employee_details.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Asking HR to change one's details (the website's Request a Change, apps/web employees/[id]/change-request; owner's
// decision, 15 October 2026): the employee file is HR's, so the employee doesn't edit it. The part's fields come filled
// with what is on file; only what changed is sent (POST /api/employees/:id/change-requests, { changes: { field: new
// value }, note }), and nothing changes until HR approves it. One request waits at a time; People checks every value
// again and says what is wrong in its words.

/// Opens the sheet for one part's fields; on sending, the profile is read again and a message says it went.
Future<void> askToChange(
  BuildContext context,
  WidgetRef ref, {
  required String employeeId,
  required EmployeeDetails details,
  required List<(String?, List<DetailField>)> groups,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final sent = await showDesignSheet<bool>(
    overAll(context),
    eyebrow: ChangeWords.eyebrow,
    title: ChangeWords.title,
    intro: ChangeWords.intro,
    builder: (context) => ChangeRequestForm(employeeId: employeeId, details: details, groups: groups),
  );
  if (sent != true) return;
  messenger.showSnackBar(const SnackBar(content: Text(ChangeWords.sent)));
  ref.invalidate(ownProfileProvider);
}

class ChangeRequestForm extends ConsumerStatefulWidget {
  const ChangeRequestForm({super.key, required this.employeeId, required this.details, required this.groups});

  final String employeeId;
  final EmployeeDetails details;
  final List<(String?, List<DetailField>)> groups;

  @override
  ConsumerState<ChangeRequestForm> createState() => _ChangeRequestFormState();
}

class _ChangeRequestFormState extends ConsumerState<ChangeRequestForm> {
  /// What is on file, as text ('' for nothing), and what the form now has.
  late final Map<String, String> _start;
  late final Map<String, String> _now;
  late final Map<String, TextEditingController> _text;
  final _note = TextEditingController();
  var _busy = false;
  String? _error;

  Iterable<DetailField> get _fields => widget.groups.expand((g) => g.$2);

  @override
  void initState() {
    super.initState();
    _start = {for (final f in _fields) f.key: widget.details.raw(f.key) ?? ''};
    _now = {..._start};
    _text = {
      for (final f in _fields)
        if (f.kind == FieldKind.text || f.kind == FieldKind.number) f.key: TextEditingController(text: _start[f.key]),
    };
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  /// The fields changed, as People takes them: text trimmed (empty: none), a year as a number.
  Map<String, Object?> _changes() {
    final out = <String, Object?>{};
    for (final f in _fields) {
      final now = (_text[f.key]?.text ?? _now[f.key] ?? '').trim();
      if (now == (_start[f.key] ?? '').trim()) continue;
      out[f.key] = now.isEmpty ? null : (f.kind == FieldKind.number ? int.tryParse(now) ?? now : now);
    }
    return out;
  }

  Future<void> _send() async {
    final changes = _changes();
    if (changes.isEmpty) {
      setState(() => _error = ChangeWords.nothingChanged);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final note = _note.text.trim();
      await ref.read(peopleClientProvider).post('/api/employees/${Uri.encodeComponent(widget.employeeId)}/change-requests', {
        'changes': changes,
        'note': note.isEmpty ? null : note,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (e) {
      if (mounted) setState(() => _error = wordsOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate(DetailField f) async {
    final kept = DateTime.tryParse(_now[f.key] ?? '');
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: kept ?? DateTime(now.year - 25, 1, 1),
      firstDate: DateTime(1940),
      lastDate: now,
      helpText: f.label,
    );
    if (picked != null) setState(() => _now[f.key] = isoDayOf(picked));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    Widget labelled(DetailField f, Widget field) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(f.label, style: text.bodyMedium?.copyWith(color: p.muted)),
            const SizedBox(height: 8),
            field,
          ],
        ),
      ),
    );

    Widget fieldOf(DetailField f) {
      switch (f.kind) {
        case FieldKind.text:
        case FieldKind.number:
          return labelled(
            f,
            TextField(
              controller: _text[f.key],
              textDirection: f.arabic ? TextDirection.rtl : null,
              keyboardType: f.kind == FieldKind.number ? TextInputType.number : (f.key.contains('mobile') ? TextInputType.phone : TextInputType.text),
              enabled: !_busy,
            ),
          );
        case FieldKind.choice:
          final current = _now[f.key] ?? '';
          final choices = {...f.choices, if (current.isNotEmpty && !f.choices.containsKey(current)) current: current};
          return labelled(
            f,
            DropdownButtonFormField<String>(
              initialValue: current.isEmpty ? null : current,
              hint: Text(ChangeWords.choose, style: text.bodyLarge?.copyWith(color: p.muted)),
              isExpanded: true,
              style: text.bodyLarge,
              icon: Icon(CupertinoIcons.chevron_down, size: 14, color: p.ink),
              items: [for (final e in choices.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
              onChanged: _busy ? null : (v) => setState(() => _now[f.key] = v ?? ''),
            ),
          );
        case FieldKind.date:
          final v = _now[f.key] ?? '';
          return labelled(
            f,
            Semantics(
              button: true,
              child: InkWell(
                onTap: _busy ? null : () => _pickDate(f),
                borderRadius: BorderRadius.circular(12),
                child: InputDecorator(
                  decoration: const InputDecoration(suffixIcon: Icon(CupertinoIcons.calendar, size: 19)),
                  child: Text(v.isEmpty ? ChangeWords.pickDate : shortDateOf(v), style: text.bodyLarge?.copyWith(color: v.isEmpty ? p.muted : p.ink)),
                ),
              ),
            ),
          );
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (heading, fields) in widget.groups) ...[
          if (heading != null) ...[
            const SizedBox(height: 6),
            Semantics(header: true, child: Text(heading, style: text.titleMedium)),
            const SizedBox(height: 12),
          ],
          for (final f in fields) fieldOf(f),
        ],
        const SizedBox(height: 6),
        MergeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(ChangeWords.note, style: text.bodyMedium?.copyWith(color: p.muted)),
              const SizedBox(height: 8),
              TextField(controller: _note, minLines: 3, maxLines: 6, maxLength: 1000, enabled: !_busy),
              Text(ChangeWords.noteHint, style: text.bodySmall),
            ],
          ),
        ),
        if (_error != null) ...[const SizedBox(height: 16), Notice(text: _error!, ok: false)],
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? ChangeWords.sending : ChangeWords.send)),
      ],
    );
  }
}
