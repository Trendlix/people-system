import 'package:flutter/material.dart';

import '../../models/my_attendance.dart';
import '../../theme/tokens.dart';
import '../../theme/wide.dart';
import 'attendance_logic.dart';

/// The month's figures in two columns (the phone design, 30 October 2026; four on an iPad, 7 November 2026): each card what it counts and the figure; an
/// absent day's figure in red. No note under the figure (owner, 31 October 2026: "remove the description below the
/// numbers to save more space"): a screen reader still hears it. The attendance rate is its own card (rate_card.dart).
class FiguresGrid extends StatelessWidget {
  const FiguresGrid({super.key, required this.month});

  final MyMonth month;

  @override
  Widget build(BuildContext context) {
    final tiles = figureTiles(month);
    return LayoutBuilder(
      builder: (context, c) {
        final across = isWide(c.maxWidth) ? 4 : 2;
        return Column(
          children: [
            for (var i = 0; i < tiles.length; i += across) ...[
              if (i > 0) const SizedBox(height: 10),
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var j = i; j < i + across; j++) ...[
                      if (j > i) const SizedBox(width: 10),
                      Expanded(child: j < tiles.length ? _Figure(tile: tiles[j]) : const SizedBox()),
                    ],
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.tile});

  final FigureTile tile;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        border: Border.all(color: p.line),
        boxShadow: p.shadow,
      ),
      child: Semantics(
        container: true,
        label: [tile.label, tile.value, ?tile.note].join(', '),
        excludeSemantics: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(tile.label, style: text.bodyMedium?.copyWith(color: p.muted, height: 1.3)),
            const SizedBox(height: 8),
            Text(
              tile.value,
              style: text.headlineMedium?.copyWith(height: 1.3, color: tile.alert ? p.danger : null, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}
