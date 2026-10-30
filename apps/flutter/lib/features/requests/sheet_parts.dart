import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../models/requests.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'request_page.dart';
import 'request_text.dart';
import 'requests_data.dart';
import 'requests_words.dart';

// The pieces every request's bottom sheet is built with (the phone design's "New request — New leave", Figma 11:2077):
// a field's label over it and its hint under it, a day or a time to pick, choices as pills, a list to pick from, a box
// to write in, a note of the rules, the live checks ("Before you can send it:"), People's refusal in its words, photos
// to attach, and Cancel / Send request. Colours from the palette only, so light and dark both work.

/// What a sheet calls once People has kept the request: the sheet closes and the request's page opens in the tab,
/// saying where it goes next.
typedef SentHandler = void Function(PeopleRequest made, String notice);

/// Opens a request's sheet over the whole app (the tab bar under it), from the tab's [context]: the sheet's [builder]
/// gets the sheet's own context and what to call once sent.
Future<void> openRequestSheet(
  BuildContext context, {
  required String title,
  required IconData icon,
  String? intro,
  String eyebrow = RequestsWords.newRequest,
  required Widget Function(BuildContext sheetContext, SentHandler sent) builder,
}) {
  final tab = Navigator.of(context);
  final root = Navigator.of(context, rootNavigator: true);
  return showDesignSheet<void>(
    root.context,
    eyebrow: eyebrow,
    title: title,
    icon: icon,
    intro: intro,
    builder: (sheetContext) => builder(sheetContext, (made, notice) {
      Navigator.of(sheetContext).pop();
      tab.push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: made.kind, id: made.id, initial: made, notice: notice)));
    }),
  );
}

/// People's refusal as a list of its sentences, its dates and times as the website shows them.
List<String> refusalOf(Object error) => error is ApiException ? [for (final m in error.messages) shownMessage(m)] : [PeopleClient.unreachableText];

/// A field: its label (with "(optional)"), the field, and a hint under it.
class SheetField extends StatelessWidget {
  const SheetField({super.key, required this.label, this.optional = false, this.hint, required this.child});

  final String label;
  final bool optional;
  final String? hint;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: label),
                if (optional) TextSpan(text: ' ${RequestsWords.optional}', style: text.bodySmall),
              ],
            ),
            style: text.labelMedium?.copyWith(height: 1.5),
          ),
          const SizedBox(height: 8),
          child,
          if (hint != null) ...[const SizedBox(height: 6), Text(hint!, style: text.bodySmall)],
        ],
      ),
    );
  }
}

/// The design's field box (raised, a thin line, 10 corners) with something to tap in it.
class _TapBox extends StatelessWidget {
  const _TapBox({required this.text, required this.placeholder, required this.icon, required this.onTap, required this.semantics, this.trailing});

  final String? text;
  final String placeholder;
  final IconData icon;
  final VoidCallback? onTap;
  final String semantics;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final style = Theme.of(context).textTheme.bodyLarge;
    return Semantics(
      button: true,
      label: semantics,
      excludeSemantics: true,
      child: Material(
        color: p.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: p.line)),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: onTap == null ? p.muted : p.ink),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(text ?? placeholder, style: style?.copyWith(color: text == null || onTap == null ? p.muted : p.ink)),
                  ),
                  ?trailing,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A day to pick (YYYY-MM-DD), shown "Monday 26/10/2026"; the phone's date picker opens on a tap. [label] is said
/// with it to a screen reader.
class PickDayField extends StatelessWidget {
  const PickDayField({super.key, required this.label, required this.value, required this.onChanged, this.first, this.last, this.onClear});

  final String label;
  final String? value;
  final ValueChanged<String>? onChanged;

  /// The first and last day the picker offers (YYYY-MM-DD); a year either side of today by default.
  final String? first;
  final String? last;

  /// Offered for an optional day: clears it.
  final VoidCallback? onClear;

  Future<void> _pick(BuildContext context) async {
    final now = DateTime.now();
    final firstDay = pickerDay(first) ?? DateTime(now.year - 1, now.month, now.day);
    final lastDay = pickerDay(last) ?? DateTime(now.year + 1, now.month, now.day);
    var initial = pickerDay(value) ?? DateTime(now.year, now.month, now.day);
    if (initial.isBefore(firstDay)) initial = firstDay;
    if (initial.isAfter(lastDay)) initial = lastDay;
    final picked = await showDatePicker(context: context, initialDate: initial, firstDate: firstDay, lastDate: lastDay, helpText: label);
    if (picked != null) onChanged?.call(isoOf(picked));
  }

  /// YYYY-MM-DD, from the picker's day.
  static String isoOf(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final shown = value == null ? null : dayWords(value!);
    return _TapBox(
      text: shown,
      placeholder: RequestsWords.chooseDay,
      icon: CupertinoIcons.calendar,
      onTap: onChanged == null ? null : () => _pick(context),
      semantics: '$label: ${shown ?? RequestsWords.chooseDay}',
      trailing: value != null && onClear != null
          ? IconButton(tooltip: RequestsWords.clear, onPressed: onClear, icon: Icon(CupertinoIcons.xmark_circle, size: 18, color: context.palette.muted))
          : null,
    );
  }
}

/// A time to pick (HH:MM), shown on a 12-hour clock; the phone's time picker opens on a tap.
class PickTimeField extends StatelessWidget {
  const PickTimeField({super.key, required this.label, required this.value, required this.onChanged, this.onClear});

  final String label;
  final String? value;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onClear;

  Future<void> _pick(BuildContext context) async {
    final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(value ?? '');
    final initial = m == null ? const TimeOfDay(hour: 9, minute: 0) : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!));
    final picked = await showTimePicker(context: context, initialTime: initial, helpText: label);
    if (picked != null) onChanged?.call('${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
  }

  @override
  Widget build(BuildContext context) {
    final shown = value == null ? null : time12(value!);
    return _TapBox(
      text: shown,
      placeholder: RequestsWords.chooseTime,
      icon: CupertinoIcons.clock,
      onTap: onChanged == null ? null : () => _pick(context),
      semantics: '$label: ${shown ?? RequestsWords.chooseTime}',
      trailing: value != null && onClear != null
          ? IconButton(tooltip: RequestsWords.clear, onPressed: onClear, icon: Icon(CupertinoIcons.xmark_circle, size: 18, color: context.palette.muted))
          : null,
    );
  }
}

/// Choices as pills: the chosen one filled (black on light); one tap each. A choice may be off ([enabled]).
class ChoicePills<T> extends StatelessWidget {
  const ChoicePills({super.key, required this.values, required this.labelOf, required this.selected, required this.onChanged, this.enabled});

  final List<T> values;
  final String Function(T) labelOf;
  final T? selected;
  final ValueChanged<T> onChanged;
  final bool Function(T)? enabled;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final v in values)
          Builder(
            builder: (context) {
              final on = v == selected;
              final can = enabled?.call(v) ?? true;
              return Semantics(
                selected: on,
                button: true,
                enabled: can,
                child: Material(
                  color: on ? p.primary : p.raised,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Tokens.radiusPill),
                    side: BorderSide(color: on ? p.primary : p.line),
                  ),
                  child: InkWell(
                    onTap: can ? () => onChanged(v) : null,
                    borderRadius: BorderRadius.circular(Tokens.radiusPill),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 44, minWidth: 48),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                        child: Text(
                          labelOf(v),
                          textAlign: TextAlign.center,
                          style: text.labelMedium?.copyWith(color: on ? p.onPrimary : (can ? p.ink : p.muted.withValues(alpha: 0.6))),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
      ],
    );
  }
}

/// One of a list to pick (a type, a colleague): the phone's menu opens on a tap.
class PickListField<T> extends StatelessWidget {
  const PickListField({super.key, required this.label, required this.value, required this.items, required this.onChanged, required this.placeholder});

  final String label;
  final T? value;
  final List<(T, String)> items;
  final ValueChanged<T?>? onChanged;
  final String placeholder;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      label: label,
      child: DropdownButtonFormField<T>(
        initialValue: value,
        isExpanded: true,
        hint: Text(placeholder, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: p.muted)),
        icon: Icon(CupertinoIcons.chevron_down, size: 16, color: p.ink),
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        dropdownColor: p.card,
        decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
        items: [
          for (final (v, words) in items)
            DropdownMenuItem<T>(
              value: v,
              child: Text(words, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: onChanged,
      ),
    );
  }
}

/// A box to write in: one line, or several ([lines]); at most [max] characters.
class SheetTextBox extends StatelessWidget {
  const SheetTextBox({super.key, required this.controller, required this.label, this.hint, this.lines = 1, this.max, this.keyboard, this.onChanged});

  final TextEditingController controller;
  final String label;
  final String? hint;
  final int lines;
  final int? max;
  final TextInputType? keyboard;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    // the label above says what it is: a screen reader hears it with the box
    return Semantics(
      label: label,
      textField: true,
      child: TextField(
        key: ValueKey('text:$label'),
        controller: controller,
        minLines: lines,
        maxLines: lines == 1 ? 1 : lines + 3,
        maxLength: max,
        keyboardType: keyboard ?? (lines > 1 ? TextInputType.multiline : TextInputType.text),
        textCapitalization: TextCapitalization.sentences,
        onChanged: onChanged,
        decoration: InputDecoration(hintText: hint, counterText: '', hintMaxLines: 2),
      ),
    );
  }
}

/// A quiet box of what the rules give (a balance, an allowance, a shift), each line under the other; the first strong.
class RulesNote extends StatelessWidget {
  const RulesNote({super.key, required this.lines, this.icon});

  final List<String> lines;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    if (lines.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 22),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusControl), border: Border.all(color: p.line)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, size: 18, color: p.ink),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (i, l) in lines.indexed)
                  Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 4),
                    child: Text(l, style: i == 0 ? text.bodyMedium : text.bodySmall),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The live checks: what stops it being sent ("Before you can send it:"), or the line saying what will be sent and to
/// whom. People checks everything again when it is sent.
class SendChecks extends StatelessWidget {
  const SendChecks({super.key, required this.problems, this.ready});

  final List<String> problems;
  final String? ready;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    if (problems.isEmpty && ready == null) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: problems.isEmpty ? p.line : p.danger.withValues(alpha: 0.45)),
      ),
      child: problems.isEmpty
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(CupertinoIcons.checkmark_circle, size: 18, color: p.ink),
                const SizedBox(width: 10),
                Expanded(child: Text(ready!, style: text.bodyMedium)),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(RequestsWords.beforeYouSend, style: text.labelMedium?.copyWith(color: p.danger)),
                const SizedBox(height: 6),
                for (final problem in problems)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('•  ', style: text.bodyMedium),
                        Expanded(child: Text(problem, style: text.bodyMedium)),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

/// People's refusal in its words, over the buttons.
class PeopleRefusal extends StatelessWidget {
  const PeopleRefusal({super.key, required this.messages});

  final List<String> messages;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Semantics(
        liveRegion: true,
        child: Notice(text: messages.length == 1 ? messages.first : messages.map((m) => '• $m').join('\n'), ok: false),
      ),
    );
  }
}

/// Cancel (closes the sheet) and Send request (off while [onSend] is null; "Sending…" while [busy]).
class SheetButtons extends StatelessWidget {
  const SheetButtons({super.key, required this.onSend, this.busy = false, this.sendLabel = RequestsWords.send});

  final VoidCallback? onSend;
  final bool busy;
  final String sendLabel;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(10));
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: busy ? null : () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget), shape: shape),
            child: const Text(RequestsWords.cancel),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: FilledButton(
            onPressed: busy ? null : onSend,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget), shape: shape),
            child: Text(busy ? RequestsWords.sending : sendLabel),
          ),
        ),
      ],
    );
  }
}

/// A switch with its words ("Half a day").
class SwitchRow extends StatelessWidget {
  const SwitchRow({super.key, required this.label, required this.value, required this.onChanged, this.hint});

  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: MergeSemantics(
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: text.labelMedium?.copyWith(color: onChanged == null ? context.palette.muted : null)),
                  if (hint != null) Text(hint!, style: text.bodySmall),
                ],
              ),
            ),
            Switch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

/// Photos to send with it (a document, a receipt, a signed letter): Take a photo, Choose a photo, each kept listed with
/// its size and a way to remove it; at most [max].
class PhotosField extends ConsumerStatefulWidget {
  const PhotosField({super.key, required this.photos, required this.onChanged, this.max = 3});

  final List<PickedPhoto> photos;
  final ValueChanged<List<PickedPhoto>> onChanged;
  final int max;

  @override
  ConsumerState<PhotosField> createState() => _PhotosFieldState();
}

class _PhotosFieldState extends ConsumerState<PhotosField> {
  String? _problem;

  Future<void> _add(bool camera) async {
    try {
      final photo = await ref.read(photoSourceProvider).pick(camera: camera);
      if (photo == null || !mounted) return;
      setState(() => _problem = null);
      widget.onChanged([...widget.photos, photo]);
    } on Exception {
      if (mounted) setState(() => _problem = RequestsWords.photoFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final full = widget.photos.length >= widget.max;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, photo) in widget.photos.indexed)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.only(left: 6),
            decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(10), border: Border.all(color: p.line)),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Image.memory(photo.bytes, width: 36, height: 36, fit: BoxFit.cover, errorBuilder: (_, _, _) => Icon(CupertinoIcons.photo, size: 20, color: p.muted)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('${photo.name} · ${sizeText(photo.bytes.length)}', style: text.bodySmall?.copyWith(color: p.ink), maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
                IconButton(
                  tooltip: RequestsWords.removeFile(photo.name),
                  onPressed: () => widget.onChanged([...widget.photos]..removeAt(i)),
                  icon: Icon(CupertinoIcons.xmark, size: 16, color: p.ink),
                ),
              ],
            ),
          ),
        if (!full)
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _add(true),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  icon: const Icon(CupertinoIcons.camera, size: 17),
                  label: const Text(RequestsWords.takePhoto),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _add(false),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  icon: const Icon(CupertinoIcons.photo, size: 17),
                  label: const Text(RequestsWords.choosePhoto),
                ),
              ),
            ],
          ),
        if (_problem != null) ...[const SizedBox(height: 6), Text(_problem!, style: text.bodySmall?.copyWith(color: p.danger))],
      ],
    );
  }
}

/// What a sheet shows while its form loads, when it couldn't load, or when People says they can't ask.
class SheetState extends StatelessWidget {
  const SheetState.loading({super.key}) : text = RequestsWords.loadingForm, onRetry = null, refusal = false;
  const SheetState.failed({super.key, required this.onRetry}) : text = RequestsWords.formNotLoaded, refusal = false;
  const SheetState.refused(this.text, {super.key}) : onRetry = null, refusal = true;

  final String text;
  final VoidCallback? onRetry;
  final bool refusal;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (onRetry == null && !refusal) ...[const Center(child: CircularProgressIndicator()), const SizedBox(height: 14)],
        if (refusal) Notice(text: this.text, ok: false) else Text(this.text, textAlign: onRetry == null ? TextAlign.center : TextAlign.start, style: text.bodyMedium),
        if (onRetry != null) ...[const SizedBox(height: 12), OutlinedButton(onPressed: onRetry, child: const Text(RequestsWords.tryAgain))],
        const SizedBox(height: 16),
        OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text(RequestsWords.cancel)),
      ],
    );
  }
}
