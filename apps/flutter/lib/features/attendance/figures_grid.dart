import 'package:flutter/material.dart';

import '../../models/my_attendance.dart';
import '../../theme/tokens.dart';
import 'attendance_logic.dart';

/// The month's figures in two columns (the phone design, 30 October 2026): each card what it counts, the figure, and a
/// note at its foot; an absent day's figure in red. The figures are People's (no attendance rate: the owner kept it for
/// HR, the CEO and Finance, 23 October 2026).
class FiguresGrid extends StatelessWidget {
  const FiguresGrid({super.key, required this.month});

  final MyMonth month;

  @override
  Widget build(BuildContext context) {
    final tiles = figureTiles(month);
    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _Figure(tile: tiles[i])),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < tiles.length ? _Figure(tile: tiles[i + 1]) : const SizedBox()),
              ],
            ),
          ),
        ],
      ],
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
      constraints: const BoxConstraints(minHeight: 150),
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        border: Border.all(color: p.line),
        boxShadow: p.shadow,
      ),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tile.label, style: text.bodyMedium?.copyWith(color: p.muted, height: 1.3)),
                const SizedBox(height: 12),
                Text(
                  tile.value,
                  style: text.headlineMedium?.copyWith(height: 1.5, color: tile.alert ? p.danger : null, fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              ],
            ),
            if (tile.note != null) ...[const SizedBox(height: 8), Text(tile.note!, style: text.bodySmall?.copyWith(height: 1.4))],
          ],
        ),
      ),
    );
  }
}
