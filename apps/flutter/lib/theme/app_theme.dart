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

/// The design's type, sized for a phone: tight headings (Figma letter-spacing −4.5% to −7%), plain body, small
/// spaced-out capitals for the labels over a card's title.
TextTheme textThemeOf(Palette p) {
  TextStyle s(double size, FontWeight weight, {double spacing = 0, double height = 1.4, Color? colour}) =>
      TextStyle(fontFamily: Tokens.font, fontSize: size, fontWeight: weight, letterSpacing: spacing, height: height, color: colour ?? p.ink);
  return TextTheme(
    // the greeting and a screen's title (Figma 43/500, −4.5%)
    displaySmall: s(34, FontWeight.w500, spacing: -1.5, height: 1.08),
    // the work-time ring's figure (Figma 28/400, −5%)
    headlineMedium: s(34, FontWeight.w400, spacing: -1.7, height: 1.1),
    // a stat's figure (Figma 22/400, −4%)
    headlineSmall: s(24, FontWeight.w400, spacing: -0.9, height: 1.15),
    // a card's title (Figma 20/500, −3.5%)
    titleLarge: s(20, FontWeight.w500, spacing: -0.7, height: 1.25),
    titleMedium: s(16, FontWeight.w500, spacing: -0.2, height: 1.35),
    titleSmall: s(14, FontWeight.w500, height: 1.35),
    bodyLarge: s(16, FontWeight.w400, height: 1.45),
    bodyMedium: s(14, FontWeight.w400, height: 1.45),
    bodySmall: s(12.5, FontWeight.w400, height: 1.4, colour: p.muted),
    labelLarge: s(15, FontWeight.w500, height: 1.2),
    labelMedium: s(12.5, FontWeight.w400, height: 1.2),
    // the label over a card's title, in capitals (Figma 10/400, +12%)
    labelSmall: s(11.5, FontWeight.w400, spacing: 1.4, height: 1.3, colour: p.muted),
  );
}
