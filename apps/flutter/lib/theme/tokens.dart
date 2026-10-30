import 'package:flutter/painting.dart';

/// Every colour, radius and spacing of the app in one place (README §1: the owner's Figma design is applied here, so
/// the screens change without being rewritten). Until it arrives: People's web colours (apps/web globals.css).
abstract final class Tokens {
  // ---------- colours ----------
  static const ink = Color(0xFF12161F);
  static const muted = Color(0xFF5B6472);
  static const line = Color(0xFFE3E6EB);
  static const canvas = Color(0xFFF4F5F7);
  static const card = Color(0xFFFFFFFF);
  static const accent = Color(0xFF2B59F0);
  static const accentSoft = Color(0xFFE8EEFF);
  static const ok = Color(0xFF0B5F58);
  static const okSoft = Color(0xFFE3F3F0);
  static const warn = Color(0xFF9A4108);
  static const warnSoft = Color(0xFFFFEFE2);
  static const danger = Color(0xFFB42318);
  static const dangerSoft = Color(0xFFFDECEA);

  /// The red dot of the owner's icon (apps/mobile colors.xml `trendlix_red`).
  static const brandRed = Color(0xFFE21D3B);

  // ---------- shapes and spacing ----------
  static const radiusCard = 20.0;
  static const radiusControl = 14.0;
  static const radiusPill = 999.0;
  static const gap = 16.0;
  static const gapSmall = 8.0;
  static const pagePadding = EdgeInsets.symmetric(horizontal: 20, vertical: 16);

  /// The smallest a thing to tap may be (accessibility: 48 on Android).
  static const tapTarget = 48.0;
}
