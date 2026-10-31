import 'package:flutter/material.dart';

/// The time worked as it ticks (owner, 31 October 2026: "make it realtime count"): the hours and minutes large, the
/// seconds beside them at half the size; the clock before checking in has no seconds. Never wider than its place (a
/// narrow phone scales it down).
class WorkClock extends StatelessWidget {
  const WorkClock({super.key, required this.main, this.seconds, required this.style, this.semanticsLabel});

  /// "02:41" (or the time now, "09:58").
  final String main;

  /// ":07", or none.
  final String? seconds;
  final TextStyle? style;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final size = style?.fontSize ?? 64;
    return FittedBox(
      fit: BoxFit.scaleDown,
      alignment: AlignmentDirectional.centerStart,
      child: Text.rich(
        TextSpan(
          text: main,
          children: [if (seconds != null) TextSpan(text: seconds, style: style?.copyWith(fontSize: size * 0.5, letterSpacing: -size * 0.02))],
        ),
        style: style,
        semanticsLabel: semanticsLabel,
        maxLines: 1,
      ),
    );
  }
}
