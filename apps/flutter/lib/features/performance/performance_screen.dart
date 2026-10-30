import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../format.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';

/// My performance (the Dashboard's quick action): one's own monthly KPI scorecards, newest first, each with its step,
/// and once signed off its final % and level. Rating and signing stay on the People website for now.
class PerformanceScreen extends ConsumerWidget {
  const PerformanceScreen({super.key});

  static const title = 'My performance';
  static const intro = 'Your monthly scorecard, built from your job description. You rate it and sign it on the People website.';
  static const none =
      'No scorecards yet. A month’s scorecard opens on the 1st of the next month once HR has published the template for your job title.';
  static const failed = 'Couldn’t load your scorecards.';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final p = context.palette;
    final cards = ref.watch(myKpisProvider);
    return ListView(
      padding: tabPagePadding(context),
      children: [
        const PageHead(eyebrow: 'People System · Performance', title: title, intro: intro),
        const SizedBox(height: 24),
        cards.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (_, _) => const Notice(text: failed, ok: false),
          data: (list) => list.isEmpty
              ? SurfaceCard(
                  child: Text(none, style: text.bodyMedium?.copyWith(color: p.muted)),
                )
              : Column(
                  children: [
                    for (final k in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: SurfaceCard(
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(monthNameOf(k.month), style: text.titleLarge),
                                    const SizedBox(height: 4),
                                    Text(k.levelLabel ?? k.statusLabel, style: text.bodySmall),
                                  ],
                                ),
                              ),
                              if (k.finalPercent != null)
                                Text('${oneDecimal(k.finalPercent!)}%', style: text.headlineMedium)
                              else
                                Pill(k.statusLabel),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
