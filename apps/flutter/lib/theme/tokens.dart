import 'package:flutter/material.dart';

// The owner's design, in one place (README §1 and Phase 5). From the Figma file "PeopleTrendlix" (30 October 2026: the
// desktop version, then its page "Mobile Flutter App", light and dark): its font, colours, radii and shadows. The
// screens take every look from here.

abstract final class Tokens {
  /// The design's one font (assets/fonts, SIL Open Font License).
  static const font = 'Instrument Sans';

  // ---------- shapes ----------
  /// Cards (the phone design's 20).
  static const radiusCard = 20.0;

  /// Tiles inside a page: the quick actions, the figures, the tab bar's buttons (Figma 16).
  static const radiusTile = 16.0;

  /// Buttons, fields, icon tiles (Figma 12).
  static const radiusControl = 12.0;

  /// Badges and the avatar's pill (Figma 99).
  static const radiusPill = 999.0;

  // ---------- spacing ----------
  static const gap = 16.0;
  static const gapSmall = 8.0;
  static const pagePadding = EdgeInsets.fromLTRB(18, 16, 18, 32);

  /// Room under a tab's page for the floating tab bar (72 high, 12 from the bottom).
  static const underTabBar = 112.0;
  static const cardPadding = EdgeInsets.all(20);

  /// The smallest a thing to tap may be (accessibility: 48 on Android).
  static const tapTarget = 48.0;

  /// The main buttons' height.
  static const buttonHeight = 54.0;

  /// The square tiles icons sit in (Figma 40).
  static const iconTile = 40.0;

  /// The wordmark's red (its "LIX.").
  static const brandRed = Color(0xFFE41D40);
}

/// The design's colours, light and dark (the Figma file has both). Read with `context.palette`.
@immutable
class Palette extends ThemeExtension<Palette> {
  const Palette({
    required this.brightness,
    required this.canvas,
    required this.card,
    required this.raised,
    required this.line,
    required this.ink,
    required this.muted,
    required this.track,
    required this.primary,
    required this.onPrimary,
    required this.danger,
    required this.warn,
    required this.ok,
    required this.shadow,
    required this.inverse,
    required this.onInverse,
    required this.inverseMuted,
    required this.tabTint,
    required this.tabStroke,
    required this.tabActive,
    required this.tabInactive,
  });

  final Brightness brightness;

  /// The page behind the cards.
  final Color canvas;

  /// Cards, fields and the small buttons.
  final Color card;

  /// Inside a card: icon tiles, badges, fields.
  final Color raised;

  /// Borders and dividers.
  final Color line;

  /// Text and icons.
  final Color ink;

  /// Secondary text.
  final Color muted;

  /// What a ring or a bar fills over.
  final Color track;

  /// The main button (black on light, off-white on dark).
  final Color primary;
  final Color onPrimary;

  /// A refusal or a problem: the design has no colour for it, so a quiet red.
  final Color danger;

  /// The owner's colours for a share achieved (31 October 2026: "below 80% color it red, from 80 to 90 color it yellow,
  /// above 90% green"): red is [danger], then yellow and green, each readable on this look's cards.
  final Color warn;
  final Color ok;

  /// A card's soft shadow.
  final List<BoxShadow> shadow;

  /// The one card that stands out (the Dashboard's "Today's shift", the Profile's head): near-black on the light look,
  /// off-white on the dark one, with its own text colours.
  final Color inverse;
  final Color onInverse;
  final Color inverseMuted;

  /// The floating tab bar: frosted (its tint over the blur), its line, the current tab's pill and the others' words.
  final Color tabTint;
  final Color tabStroke;
  final Color tabActive;
  final Color tabInactive;

  static const light = Palette(
    brightness: Brightness.light,
    canvas: Color(0xFFEDEDEB),
    card: Color(0xFFFFFFFF),
    raised: Color(0xFFF8F8F6),
    line: Color(0xFFDEDED9),
    ink: Color(0xFF111110),
    muted: Color(0xFF777773),
    track: Color(0xFFE7E7E3),
    primary: Color(0xFF151514),
    onPrimary: Color(0xFFFFFFFF),
    danger: Color(0xFFB42318),
    warn: Color(0xFFA15C07),
    ok: Color(0xFF067647),
    shadow: [BoxShadow(color: Color(0x12141412), offset: Offset(0, 18), blurRadius: 50)],
    inverse: Color(0xFF111110),
    onInverse: Color(0xFFF8F8F4),
    inverseMuted: Color(0xFFA5A59F),
    tabTint: Color(0xB8EDEDEB),
    tabStroke: Color(0xFF343431),
    tabActive: Color(0xFFF7F7F2),
    tabInactive: Color(0xFF8A8A84),
  );

  static const dark = Palette(
    brightness: Brightness.dark,
    canvas: Color(0xFF0D0D0C),
    card: Color(0xFF1C1C1A),
    raised: Color(0xFF151514),
    line: Color(0xFF30302D),
    ink: Color(0xFFF4F4EF),
    muted: Color(0xFF92928C),
    track: Color(0xFF272725),
    primary: Color(0xFFF3F3EE),
    onPrimary: Color(0xFF1C1C1A),
    danger: Color(0xFFF97066),
    warn: Color(0xFFFAC515),
    ok: Color(0xFF47CD89),
    shadow: [BoxShadow(color: Color(0x38000000), offset: Offset(0, 18), blurRadius: 50)],
    inverse: Color(0xFFF3F3EE),
    onInverse: Color(0xFF111110),
    inverseMuted: Color(0xFF6B6B66),
    tabTint: Color(0x991C1C1A),
    tabStroke: Color(0xFF343431),
    tabActive: Color(0xFFF7F7F2),
    tabInactive: Color(0xFF9D9D97),
  );

  bool get isDark => brightness == Brightness.dark;

  @override
  Palette copyWith({
    Brightness? brightness,
    Color? canvas,
    Color? card,
    Color? raised,
    Color? line,
    Color? ink,
    Color? muted,
    Color? track,
    Color? primary,
    Color? onPrimary,
    Color? danger,
    Color? warn,
    Color? ok,
    List<BoxShadow>? shadow,
    Color? inverse,
    Color? onInverse,
    Color? inverseMuted,
    Color? tabTint,
    Color? tabStroke,
    Color? tabActive,
    Color? tabInactive,
  }) => Palette(
    brightness: brightness ?? this.brightness,
    canvas: canvas ?? this.canvas,
    card: card ?? this.card,
    raised: raised ?? this.raised,
    line: line ?? this.line,
    ink: ink ?? this.ink,
    muted: muted ?? this.muted,
    track: track ?? this.track,
    primary: primary ?? this.primary,
    onPrimary: onPrimary ?? this.onPrimary,
    danger: danger ?? this.danger,
    warn: warn ?? this.warn,
    ok: ok ?? this.ok,
    shadow: shadow ?? this.shadow,
    inverse: inverse ?? this.inverse,
    onInverse: onInverse ?? this.onInverse,
    inverseMuted: inverseMuted ?? this.inverseMuted,
    tabTint: tabTint ?? this.tabTint,
    tabStroke: tabStroke ?? this.tabStroke,
    tabActive: tabActive ?? this.tabActive,
    tabInactive: tabInactive ?? this.tabInactive,
  );

  @override
  Palette lerp(Palette? other, double t) {
    if (other == null) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return Palette(
      brightness: t < 0.5 ? brightness : other.brightness,
      canvas: mix(canvas, other.canvas),
      card: mix(card, other.card),
      raised: mix(raised, other.raised),
      line: mix(line, other.line),
      ink: mix(ink, other.ink),
      muted: mix(muted, other.muted),
      track: mix(track, other.track),
      primary: mix(primary, other.primary),
      onPrimary: mix(onPrimary, other.onPrimary),
      danger: mix(danger, other.danger),
      warn: mix(warn, other.warn),
      ok: mix(ok, other.ok),
      shadow: BoxShadow.lerpList(shadow, other.shadow, t) ?? other.shadow,
      inverse: mix(inverse, other.inverse),
      onInverse: mix(onInverse, other.onInverse),
      inverseMuted: mix(inverseMuted, other.inverseMuted),
      tabTint: mix(tabTint, other.tabTint),
      tabStroke: mix(tabStroke, other.tabStroke),
      tabActive: mix(tabActive, other.tabActive),
      tabInactive: mix(tabInactive, other.tabInactive),
    );
  }
}

/// A share achieved, in the owner's three bands (31 October 2026), by the whole percent shown: under 80 low (red), 80 to 90
/// mid (yellow), over 90 high (green). The website's (packages/shared attendance-history.ts rateBand).
enum RateBand { low, mid, high }

RateBand? rateBandOf(double? share) {
  if (share == null || !share.isFinite) return null;
  final percent = (share * 100).round();
  return percent < 80 ? RateBand.low : (percent <= 90 ? RateBand.mid : RateBand.high);
}

extension BandColours on Palette {
  /// A band's colour on this look's cards; `onInverse`: on the one card that stands out, which is the other look's
  /// background, so the other look's colour.
  Color bandColour(RateBand band, {bool onInverse = false}) {
    final from = onInverse ? (isDark ? Palette.light : Palette.dark) : this;
    return switch (band) {
      RateBand.low => from.danger,
      RateBand.mid => from.warn,
      RateBand.high => from.ok,
    };
  }
}

extension PaletteOf on BuildContext {
  /// The design's colours for the look in use.
  Palette get palette => Theme.of(this).extension<Palette>() ?? Palette.light;
}
