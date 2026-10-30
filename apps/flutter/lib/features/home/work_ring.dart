import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../format.dart';
import '../../models/today.dart';
import '../../theme/tokens.dart';

/// The design's work-time ring (Figma "Today" card): the time worked today in its middle, "of 8 hours" under it, the
/// ring filling as the day's hours are worked. While checked in it moves on by itself, each half-minute.
class WorkRing extends StatefulWidget {
  const WorkRing({super.key, required this.today, this.size = 196});

  final Today today;
  final double size;

  static const label = 'Work time';
  static String of(double hours) => 'of ${hoursWordsOf(hours)}';

  @override
  State<WorkRing> createState() => _WorkRingState();
}

class _WorkRingState extends State<WorkRing> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _follow();
  }

  @override
  void didUpdateWidget(WorkRing old) {
    super.didUpdateWidget(old);
    _follow();
  }

  /// Ticks only while a check-in is open: nothing moves otherwise.
  void _follow() {
    final open = widget.today.openSince != null;
    if (open && _tick == null) {
      _tick = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
    } else if (!open) {
      _tick?.cancel();
      _tick = null;
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final worked = widget.today.workedAt(DateTime.now());
    final share = (worked.inSeconds / (widget.today.hoursPerDay * 3600)).clamp(0.0, 1.0);
    final clock = workClockOf(worked);
    return Semantics(
      label: '${WorkRing.label} $clock ${WorkRing.of(widget.today.hoursPerDay)}',
      excludeSemantics: true,
      child: SizedBox.square(
        dimension: widget.size,
        child: CustomPaint(
          painter: _RingPainter(share: share, track: p.track, fill: p.ink, stroke: widget.size * 0.07),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(WorkRing.label, style: text.bodySmall),
                const SizedBox(height: 2),
                Text(clock, style: text.headlineMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                const SizedBox(height: 2),
                Text(WorkRing.of(widget.today.hoursPerDay), style: text.bodySmall),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.share, required this.track, required this.fill, required this.stroke});

  final double share;
  final Color track;
  final Color fill;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = (Offset.zero & size).deflate(stroke / 2);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = track;
    canvas.drawArc(rect, 0, math.pi * 2, false, paint);
    if (share <= 0) return;
    paint
      ..color = fill
      ..strokeCap = StrokeCap.round;
    // from the top, clockwise
    canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * share, false, paint);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.share != share || old.track != track || old.fill != fill || old.stroke != stroke;
}
