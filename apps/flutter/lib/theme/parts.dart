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
