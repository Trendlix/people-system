import 'package:flutter/material.dart';

import 'tokens.dart';

/// The app's Material theme for a look (light or dark), built only from [Tokens] and [Palette].
ThemeData appTheme([Brightness brightness = Brightness.light]) {
  final p = brightness == Brightness.dark ? Palette.dark : Palette.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.primary,
    onPrimary: p.onPrimary,
    secondary: p.ink,
    onSecondary: p.card,
    error: p.danger,
    onError: p.onPrimary,
    surface: p.card,
    onSurface: p.ink,
    onSurfaceVariant: p.muted,
    surfaceContainerHighest: p.raised,
    surfaceContainerHigh: p.card,
    surfaceContainer: p.card,
    surfaceContainerLow: p.card,
    outline: p.line,
    outlineVariant: p.line,
    surfaceTint: Colors.transparent,
    inverseSurface: p.primary,
    onInverseSurface: p.onPrimary,
  );
  final text = textThemeOf(p);
  final control = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radiusControl));
  OutlineInputBorder field(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(Tokens.radiusControl),
    borderSide: BorderSide(color: c, width: w),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: Tokens.font,
    textTheme: text,
    scaffoldBackgroundColor: p.canvas,
    canvasColor: p.canvas,
    dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),
    iconTheme: IconThemeData(color: p.ink, size: 20),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.ink, circularTrackColor: Colors.transparent),
    extensions: [p],
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.primary,
        foregroundColor: p.onPrimary,
        disabledBackgroundColor: p.primary.withValues(alpha: 0.4),
        disabledForegroundColor: p.onPrimary,
        minimumSize: const Size(Tokens.tapTarget, Tokens.buttonHeight),
        textStyle: text.labelLarge,
        shape: control,
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        backgroundColor: p.card,
        foregroundColor: p.ink,
        side: BorderSide(color: p.line),
        minimumSize: const Size(Tokens.tapTarget, Tokens.buttonHeight),
        textStyle: text.labelLarge,
        shape: control,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.ink,
        textStyle: text.labelLarge,
        shape: control,
        minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.raised,
      labelStyle: text.bodyLarge?.copyWith(color: p.muted),
      floatingLabelStyle: text.bodyMedium?.copyWith(color: p.ink),
      hintStyle: text.bodyLarge?.copyWith(color: p.muted),
      prefixIconColor: p.muted,
      suffixIconColor: p.muted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: field(p.line),
      enabledBorder: field(p.line),
      disabledBorder: field(p.line),
      focusedBorder: field(p.ink, 1.2),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        side: BorderSide(color: p.line),
      ),
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium?.copyWith(color: p.muted),
      iconColor: p.ink,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.primary,
      contentTextStyle: text.bodyMedium?.copyWith(color: p.onPrimary),
      behavior: SnackBarBehavior.floating,
      shape: control,
      elevation: 0,
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: p.card,
      surfaceTintColor: Colors.transparent,
      textStyle: text.bodyLarge,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        side: BorderSide(color: p.line),
      ),
      elevation: 8,
      shadowColor: Colors.black26,
    ),
    splashFactory: InkRipple.splashFactory,
  );
}

/// The phone design's type (Figma "Mobile Flutter App"): tight titles (letter-spacing about −5%), plain body text of 15,
/// labels of 13, and small spaced-out capitals (13, +12%) over a title.
TextTheme textThemeOf(Palette p) {
  TextStyle s(double size, FontWeight weight, {double spacing = 0, double height = 1.4, Color? colour}) =>
      TextStyle(fontFamily: Tokens.font, fontSize: size, fontWeight: weight, letterSpacing: spacing, height: height, color: colour ?? p.ink);
  return TextTheme(
    // a large figure: the leave days available (Figma 60/400, −8%)
    displayMedium: s(60, FontWeight.w400, spacing: -4.8, height: 0.85),
    // a page's title: "Good morning, Mohamed", "My Requests" (Figma 40/500, −5.5%)
    displaySmall: s(40, FontWeight.w500, spacing: -2.2, height: 0.98),
    // a figure in a card (Figma 34/400, −4%)
    headlineLarge: s(34, FontWeight.w400, spacing: -1.4, height: 1.05),
    // a stat's figure (Figma 30/400, −4%)
    headlineMedium: s(30, FontWeight.w400, spacing: -1.2, height: 1.1),
    // a section's title outside a card: "Quick actions" (Figma 28/400, −4%)
    headlineSmall: s(28, FontWeight.w400, spacing: -1.12, height: 1.25),
    // a card's title: "Coming up" (Figma 23/500, −3.5%)
    titleLarge: s(23, FontWeight.w500, spacing: -0.81, height: 1.3),
    titleMedium: s(17, FontWeight.w400, spacing: -0.2, height: 1.4),
    titleSmall: s(15, FontWeight.w500, height: 1.35),
    bodyLarge: s(15, FontWeight.w400, height: 1.5),
    bodyMedium: s(14, FontWeight.w400, height: 1.5),
    bodySmall: s(13, FontWeight.w400, height: 1.45, colour: p.muted),
    labelLarge: s(15, FontWeight.w400, height: 1.2),
    labelMedium: s(13, FontWeight.w400, height: 1.2),
    // the label over a title, in capitals (Figma 13/400, +12%)
    labelSmall: s(13, FontWeight.w400, spacing: 1.56, height: 1.5, colour: p.muted),
  );
}
