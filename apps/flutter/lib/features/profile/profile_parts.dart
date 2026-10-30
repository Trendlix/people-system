import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';

import '../../api/people_client.dart';
import '../../format.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'profile_words.dart';

// The pieces the Profile tab and the account's screens share, from the phone design (Figma "Mobile Flutter App", 30
// October 2026): a card's head with its larger title, a read-only field, a record's row, a quiet outlined button, the
// initials' circle, a load that failed, and how a moment reads.

/// 27 Oct 2026, 11:26 on the phone's clock.
String momentOf(DateTime at) => '${shortDateOf(isoDayOf(at))}, ${clockOf(at)}';

/// Where a sheet opens: over the whole app, the floating tab bar too (a tab's own navigator would leave the bar over the
/// sheet's foot, where its button is).
BuildContext overAll(BuildContext context) => Navigator.of(context, rootNavigator: true).context;

/// A refusal's words, or People's plain one.
String wordsOf(Object error) => error is ApiException ? error.message : PeopleClient.unreachableText;

/// The Profile's card head: the small capitals over a title of 25 (Figma 25/400, −4%), something on the right.
class ProfileCardHead extends StatelessWidget {
  const ProfileCardHead({super.key, required this.eyebrow, required this.title, this.intro, this.trailing});

  final String eyebrow;
  final String title;
  final String? intro;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Eyebrow(eyebrow),
                  const SizedBox(height: 5),
                  Semantics(header: true, child: Text(title, style: text.headlineSmall?.copyWith(fontSize: 25, letterSpacing: -1, height: 1.5))),
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 16), trailing!],
          ],
        ),
        if (intro != null) ...[const SizedBox(height: 8), Text(intro!, style: text.bodyLarge?.copyWith(color: context.palette.muted))],
      ],
    );
  }
}

/// A field shown, not changed: its label over its value in a quiet box (Figma: 14 muted, then a 52 high field).
class ReadOnlyField extends StatelessWidget {
  const ReadOnlyField({super.key, required this.label, required this.value, this.note, this.arabic = false});

  final String label;
  final String? value;
  final String? note;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final shown = value;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(label, style: text.bodyMedium?.copyWith(color: p.muted)),
            const SizedBox(height: 8),
            Container(
              constraints: const BoxConstraints(minHeight: 52),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              alignment: arabic && shown != null ? Alignment.centerRight : Alignment.centerLeft,
              decoration: BoxDecoration(
                color: p.raised,
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: p.line),
              ),
              child: Text(
                shown ?? ProfileWords.notOnFile,
                textDirection: arabic && shown != null ? TextDirection.rtl : null,
                style: text.bodyLarge?.copyWith(color: shown == null ? p.muted : p.ink),
              ),
            ),
            if (note != null) ...[const SizedBox(height: 6), Text(note!, style: text.bodySmall)],
          ],
        ),
      ),
    );
  }
}

/// A row of a record's list, a line above it: an icon in its small tile, a title and a line under it, an arrow when it
/// leads somewhere (Figma: 78 high, the tile 36, the title 14, the line 13 muted).
class RecordRow extends StatelessWidget {
  const RecordRow({super.key, required this.icon, required this.title, this.subtitle, this.onTap, this.trailing, this.first = false});

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;

  /// The first row: a line above it too (Figma's list starts with one).
  final bool first;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: p.raised,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: p.line),
            ),
            child: Icon(icon, size: 18, color: p.ink),
          ),
          const SizedBox(width: 17),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: text.bodyMedium),
                if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: text.bodySmall?.copyWith(height: 1.35))],
              ],
            ),
          ),
          if (trailing != null) trailing! else if (onTap != null) ...[const SizedBox(width: 11), Icon(CupertinoIcons.arrow_right, size: 16, color: p.ink)],
        ],
      ),
    );
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: p.line)),
      ),
      child: onTap == null
          ? MergeSemantics(child: row)
          : MergeSemantics(
              child: Semantics(
                button: true,
                child: Material(
                  type: MaterialType.transparency,
                  child: InkWell(onTap: onTap, child: row),
                ),
              ),
            ),
    );
  }
}

/// The design's small outlined button ("Sign out", "Manage", "Cancel"): 13 words, 9 corners, 48 to tap.
class QuietButton extends StatelessWidget {
  const QuietButton(this.label, {super.key, required this.onPressed, this.expand = false, this.semanticsLabel, this.large = false});

  final String label;
  final VoidCallback? onPressed;
  final bool expand;
  final String? semanticsLabel;

  /// The card's own action ("Edit details"): words of 14, 10 corners.
  final bool large;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final button = OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        backgroundColor: Colors.transparent,
        side: BorderSide(color: p.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(large ? 10 : 9)),
        textStyle: large ? Theme.of(context).textTheme.bodyMedium : Theme.of(context).textTheme.labelMedium,
      ),
      child: Text(label, semanticsLabel: semanticsLabel),
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// The design's black button of 42 ("Change password", "Save interview hours"): as wide as its words.
class SolidButton extends StatelessWidget {
  const SolidButton(this.label, {super.key, required this.onPressed, this.busy = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: Theme.of(context).textTheme.labelMedium,
      ),
      child: Text(label),
    );
  }
}

/// A circle with someone's initials.
class InitialsCircle extends StatelessWidget {
  const InitialsCircle({super.key, required this.name, required this.size, required this.fill, required this.ink, required this.fontSize});

  final String name;
  final double size;
  final Color fill;
  final Color ink;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(shape: BoxShape.circle, color: fill),
      child: Text(
        initialsOf(name),
        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontSize: fontSize, color: ink, height: 1.5),
        semanticsLabel: name,
      ),
    );
  }
}

/// Something that couldn't be loaded, in People's words, with Try again.
class LoadFailed extends StatelessWidget {
  const LoadFailed({super.key, required this.error, required this.onRetry, this.what = AccountWords.notLoaded});

  final Object error;
  final VoidCallback onRetry;
  final String what;

  @override
  Widget build(BuildContext context) => Notice(text: '$what ${wordsOf(error)}', ok: false, action: AccountWords.tryAgain, onAction: onRetry);
}

/// A card's wait while it loads.
class CardLoading extends StatelessWidget {
  const CardLoading({super.key});

  @override
  Widget build(BuildContext context) => const SurfaceCard(
    child: SizedBox(height: 80, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
  );
}
