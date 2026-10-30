import 'package:flutter/material.dart';

// The owner's design, in one place (README §1 and Phase 5). From the Figma file "PeopleTrendlix" (30 October 2026: the
// desktop version, light and dark): its font, colours, radii and shadows, sized for a phone. The screens take every
// look from here, so the phone version of the design can be applied without reworking them.

abstract final class Tokens {
  /// The design's one font (assets/fonts, SIL Open Font License).
  static const font = 'Instrument Sans';

  // ---------- shapes ----------
  /// Cards (Figma 18).
  static const radiusCard = 18.0;

  /// Buttons, fields, icon tiles (Figma 12).
  static const radiusControl = 12.0;

  /// Badges and the avatar's pill (Figma 99).
  static const radiusPill = 999.0;

  // ---------- spacing ----------
  static const gap = 16.0;
  static const gapSmall = 8.0;
  static const pagePadding = EdgeInsets.fromLTRB(20, 12, 20, 32);
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
    required this.shadow,
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

  /// A card's soft shadow.
  final List<BoxShadow> shadow;

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
    shadow: [BoxShadow(color: Color(0x12141412), offset: Offset(0, 18), blurRadius: 50)],
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
    shadow: [BoxShadow(color: Color(0x38000000), offset: Offset(0, 18), blurRadius: 50)],
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
    List<BoxShadow>? shadow,
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
    shadow: shadow ?? this.shadow,
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
      shadow: BoxShadow.lerpList(shadow, other.shadow, t) ?? other.shadow,
    );
  }
}

extension PaletteOf on BuildContext {
  /// The design's colours for the look in use.
  Palette get palette => Theme.of(this).extension<Palette>() ?? Palette.light;
}
