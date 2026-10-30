import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';

import 'tokens.dart';

// The design's pieces every screen builds with (Figma "PeopleTrendlix"): the card, the label over a title, the badge,
// the icon tile, the underlined link with its arrow, the notice and the wordmark.

/// A card: the page's white (or dark) block with its thin border and soft shadow.
class SurfaceCard extends StatelessWidget {
  const SurfaceCard({super.key, required this.child, this.padding = Tokens.cardPadding});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        border: Border.all(color: p.line),
        boxShadow: p.shadow,
      ),
      child: child,
    );
  }
}

/// The small spaced-out capitals over a title ("TODAY", "SCHEDULE").
class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall, semanticsLabel: text);
}

/// A card's head: its label and title, and something on the right (a badge, a link).
class CardHead extends StatelessWidget {
  const CardHead({super.key, required this.eyebrow, required this.title, this.trailing});

  final String eyebrow;
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Eyebrow(eyebrow),
              const SizedBox(height: 6),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: Tokens.gapSmall), trailing!],
      ],
    );
  }
}

/// A badge: "Not checked in", "In office". Strong is the filled one (black on light).
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.icon, this.strong = false});

  final String text;
  final IconData? icon;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final fg = strong ? p.onPrimary : p.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: strong ? p.primary : p.raised,
        borderRadius: BorderRadius.circular(Tokens.radiusPill),
        border: strong ? null : Border.all(color: p.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 5)],
          Flexible(
            child: Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg)),
          ),
        ],
      ),
    );
  }
}

/// The square an icon sits in; a button when it has [onTap].
class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key, this.onTap, this.tooltip, this.onCard = true});

  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;

  /// Inside a card (the raised colour) or on the page (the card's).
  final bool onCard;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final decoration = BoxDecoration(
      color: onCard ? p.raised : p.card,
      borderRadius: BorderRadius.circular(Tokens.radiusControl),
      border: Border.all(color: p.line),
    );
    final icon = Icon(this.icon, size: 19, color: p.ink);
    if (onTap == null) return Container(width: Tokens.iconTile, height: Tokens.iconTile, decoration: decoration, child: icon);
    // the ripple drawn on the tile's own surface, not under it
    final button = Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        onTap: onTap,
        child: Ink(width: Tokens.iconTile, height: Tokens.iconTile, decoration: decoration, child: icon),
      ),
    );
    // the tile is 40, the place to tap 48
    return SizedBox.square(
      dimension: Tokens.tapTarget,
      child: Center(
        child: tooltip == null ? button : Tooltip(message: tooltip, child: button),
      ),
    );
  }
}

/// The design's quiet action: words underlined, an arrow after ("Check out →", "Review profile →").
class ArrowLink extends StatelessWidget {
  const ArrowLink(this.text, {super.key, required this.onTap});

  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.only(bottom: 3),
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: p.ink)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(text, style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w400)),
                      const SizedBox(width: 8),
                      Icon(CupertinoIcons.arrow_right, size: 16, color: p.ink),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Something to say after an action: good news, or a problem and what to do about it.
class Notice extends StatelessWidget {
  const Notice({super.key, required this.text, required this.ok, this.action, this.onAction});

  final String text;
  final bool ok;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: ok ? p.line : p.danger.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Icon(ok ? CupertinoIcons.checkmark_circle : CupertinoIcons.exclamationmark_circle, size: 20, color: ok ? p.ink : p.danger),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
            ],
          ),
          if (action != null && onAction != null)
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: ArrowLink(action!, onTap: onAction!),
            ),
        ],
      ),
    );
  }
}

/// The TrendLIX wordmark, its "Trend" off-white on the dark look.
class Wordmark extends StatelessWidget {
  const Wordmark({super.key, this.height = 26, this.forDark});

  final double height;

  /// Which version: as the look is when null.
  final bool? forDark;

  @override
  Widget build(BuildContext context) {
    final dark = forDark ?? context.palette.isDark;
    return Image.asset(
      dark ? 'assets/brand/wordmark_dark.png' : 'assets/brand/wordmark.png',
      height: height,
      fit: BoxFit.contain,
      semanticLabel: 'Trendlix',
      filterQuality: FilterQuality.medium,
    );
  }
}

/// The app's name as the design's header has it: the wordmark in its white tile, "Trendlix" and "People System".
class BrandLine extends StatelessWidget {
  const BrandLine({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: Tokens.iconTile,
          height: Tokens.iconTile,
          padding: const EdgeInsets.symmetric(horizontal: 5),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: p.line),
          ),
          child: const Wordmark(height: 8, forDark: false),
        ),
        const SizedBox(width: 10),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Trendlix', style: text.titleSmall?.copyWith(fontWeight: FontWeight.w600, height: 1.2)),
            Text('People System', style: text.bodySmall?.copyWith(height: 1.25)),
          ],
        ),
      ],
    );
  }
}

// ---------- the phone design's pieces (Figma "Mobile Flutter App", 30 October 2026) ----------

/// A page's head: the small capitals ("PEOPLE SYSTEM · REQUESTS"), the large title, a line under it.
class PageHead extends StatelessWidget {
  const PageHead({super.key, this.eyebrow, required this.title, this.intro});

  final String? eyebrow;
  final String title;
  final String? intro;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (eyebrow != null) ...[Eyebrow(eyebrow!), const SizedBox(height: 8)],
        Text(title, style: text.displaySmall),
        if (intro != null) ...[const SizedBox(height: 10), Text(intro!, style: text.bodyLarge?.copyWith(color: context.palette.muted))],
      ],
    );
  }
}

/// A section's head outside a card: the small capitals over a title ("SELF SERVICE" over "Quick actions"), and a link
/// on the right.
class SectionHead extends StatelessWidget {
  const SectionHead({super.key, required this.eyebrow, required this.title, this.action, this.onAction});

  final String eyebrow;
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Eyebrow(eyebrow), const SizedBox(height: 4), Text(title, style: Theme.of(context).textTheme.headlineSmall)],
          ),
        ),
        if (action != null && onAction != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget), padding: const EdgeInsets.symmetric(horizontal: 4)),
            child: Text(action!, style: Theme.of(context).textTheme.labelMedium),
          ),
      ],
    );
  }
}

/// A row to tap in a list: an icon in its tile, a title and a line under it, an arrow ("Change password — Password and
/// sign-in security →").
class ListRow extends StatelessWidget {
  const ListRow({super.key, required this.icon, required this.title, this.subtitle, required this.onTap, this.trailing});

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              IconTile(icon),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: text.bodyLarge),
                    if (subtitle != null) Text(subtitle!, style: text.bodySmall),
                  ],
                ),
              ),
              trailing ?? Icon(CupertinoIcons.arrow_right, size: 18, color: p.ink),
            ],
          ),
        ),
      ),
    );
  }
}

/// The design's segmented switch ("All · Approved · Waiting", "Week · Month"): the chosen one a black pill.
class SegmentedTabs<T> extends StatelessWidget {
  const SegmentedTabs({super.key, required this.values, required this.labelOf, required this.selected, required this.onChanged, this.expand = false});

  final List<T> values;
  final String Function(T) labelOf;
  final T selected;
  final ValueChanged<T> onChanged;

  /// Each takes an equal share of the width (Week · Month), else as wide as its words (All · Approved · Waiting).
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    Widget item(T v) {
      final on = v == selected;
      final child = Semantics(
        selected: on,
        button: true,
        child: InkWell(
          onTap: () => onChanged(v),
          borderRadius: BorderRadius.circular(Tokens.radiusPill),
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(color: on ? p.primary : Colors.transparent, borderRadius: BorderRadius.circular(Tokens.radiusPill)),
            child: Text(labelOf(v), style: text.labelMedium?.copyWith(color: on ? p.onPrimary : p.muted)),
          ),
        ),
      );
      return expand ? Expanded(child: child) : child;
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(Tokens.radiusPill), border: Border.all(color: p.line)),
      child: Material(type: MaterialType.transparency, child: Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, children: [for (final v in values) item(v)])),
    );
  }
}

/// A figure in its own card: what it counts, the figure (its unit small after it) and a line under it.
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.unit, this.note, this.onTap, this.width});

  final String label;
  final String value;
  final String? unit;
  final String? note;
  final VoidCallback? onTap;
  final double? width;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final body = Container(
      width: width,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(Tokens.radiusCard), border: Border.all(color: p.line), boxShadow: p.shadow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: text.bodySmall),
          const SizedBox(height: 6),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: value, style: text.headlineMedium),
                if (unit != null) TextSpan(text: ' $unit', style: text.bodySmall),
              ],
            ),
          ),
          if (note != null) ...[const SizedBox(height: 10), Text(note!, style: text.bodySmall)],
        ],
      ),
    );
    if (onTap == null) return body;
    return GestureDetector(onTap: onTap, behavior: HitTestBehavior.opaque, child: Semantics(button: true, child: body));
  }
}

/// The design's bottom sheet ("New request — New leave"): the small capitals, the title with an icon, a line under it,
/// the close button; its body scrolls; the keyboard pushes it up.
Future<T?> showDesignSheet<T>(BuildContext context, {String? eyebrow, required String title, IconData? icon, String? intro, required WidgetBuilder builder}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: false,
    backgroundColor: Colors.transparent,
    builder: (context) => _DesignSheet(eyebrow: eyebrow, title: title, icon: icon, intro: intro, child: builder(context)),
  );
}

class _DesignSheet extends StatelessWidget {
  const _DesignSheet({required this.eyebrow, required this.title, required this.icon, required this.intro, required this.child});

  final String? eyebrow;
  final String title;
  final IconData? icon;
  final String? intro;
  final Widget child;

  static const close = 'Close';

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border(top: BorderSide(color: p.line)),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 22, 22, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (eyebrow != null) ...[Eyebrow(eyebrow!), const SizedBox(height: 10)],
                        Row(
                          children: [
                            if (icon != null) ...[Icon(icon, size: 28, color: p.ink), const SizedBox(width: 10)],
                            Flexible(child: Text(title, style: text.headlineSmall)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: close,
                    onPressed: () => Navigator.of(context).pop(),
                    style: IconButton.styleFrom(side: BorderSide(color: p.line), minimumSize: const Size(44, 44)),
                    icon: Icon(CupertinoIcons.xmark, size: 18, color: p.ink),
                  ),
                ],
              ),
              if (intro != null) ...[const SizedBox(height: 10), Text(intro!, style: text.bodyLarge?.copyWith(color: p.muted))],
              const SizedBox(height: 20),
              child,
            ],
          ),
        ),
      ),
    );
  }
}
