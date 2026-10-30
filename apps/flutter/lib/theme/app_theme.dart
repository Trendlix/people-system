import 'package:flutter/material.dart';

import 'tokens.dart';

/// The app's Material theme, built only from [Tokens] (the design lives there).
ThemeData appTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Tokens.accent,
    primary: Tokens.accent,
    onPrimary: Colors.white,
    surface: Tokens.card,
    onSurface: Tokens.ink,
    error: Tokens.danger,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radiusControl));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Tokens.canvas,
    appBarTheme: const AppBarTheme(backgroundColor: Tokens.canvas, foregroundColor: Tokens.ink, elevation: 0, centerTitle: false),
    cardTheme: CardThemeData(
      color: Tokens.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radiusCard)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget), shape: rounded),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget), shape: rounded),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Tokens.card,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radiusControl), borderSide: const BorderSide(color: Tokens.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radiusControl), borderSide: const BorderSide(color: Tokens.line)),
    ),
  );
}
