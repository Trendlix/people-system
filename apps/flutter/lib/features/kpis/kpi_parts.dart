import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';

import '../../format.dart';
import '../../models/kpi.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'kpi_words.dart';

// The KPI screens' small pieces, in the phone design (lib/theme/parts.dart): the way back, a scorecard's step and level
// as badges, and a scorecard as a row of a list, opening its page.

/// The way back to the page before ("< My KPIs").
class KpiBack extends StatelessWidget {
  const KpiBack(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        onPressed: () => Navigator.of(context).maybePop(),
        style: TextButton.styleFrom(padding: const EdgeInsets.only(left: 4, right: 12), minimumSize: const Size(Tokens.tapTarget, Tokens.tapTarget)),
        icon: Icon(CupertinoIcons.chevron_left, size: 16, color: p.ink),
        label: Text(label, style: Theme.of(context).textTheme.labelMedium),
      ),
    );
  }
}

/// Where a scorecard stands, as a badge: "Self-rating", "With the manager", "Final" (final the filled one).
class KpiStatusPill extends StatelessWidget {
  const KpiStatusPill(this.card, {super.key});

  final KpiScorecard card;

  @override
  Widget build(BuildContext context) => Pill(statusText(card.status, card.scorerKind), strong: card.status == 'final');
}

/// A scorecard in a list: whose (or the month), a line under it, its final % or its step, and its page on a tap.
class KpiScorecardRow extends StatelessWidget {
  const KpiScorecardRow({super.key, required this.card, required this.title, required this.subtitle, required this.onTap, this.button});

  final KpiScorecard card;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  /// What waits for the caller on it ("Rate yourself", "Score", "Sign"): a button instead of the score.
  final String? button;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Tokens.radiusControl),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Tokens.tapTarget),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: text.bodyLarge),
                        const SizedBox(height: 2),
                        Text(subtitle, style: text.bodySmall),
                        if (card.selfMissed) Text(KpiWords.selfMissedShort, style: text.bodySmall?.copyWith(color: p.danger)),
                        if (card.unsigned) Text(KpiWords.unsignedShort, style: text.bodySmall?.copyWith(color: p.danger)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  if (button != null)
                    Pill(button!, strong: true)
                  else if (card.finalPercent != null)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(kpiPercentText(card.finalPercent!), style: text.titleLarge),
                        if (card.levelLabel != null) Text(card.levelLabel!, style: text.bodySmall),
                      ],
                    )
                  else
                    KpiStatusPill(card),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The line under one's own scorecard in History: the level and step, or why there is no score yet.
String historyLine(KpiScorecard k) {
  final step = statusText(k.status, k.scorerKind);
  if (k.finalPercent != null) return [?k.levelLabel, step].join(' · ');
  return '${k.status == 'final' ? KpiWords.noScore : KpiWords.shownAtSignOff} · $step';
}

/// A scorecard of someone the caller scores, in a line: their job title and the step ("Designer · With the manager").
String teamLine(KpiScorecard k) => [?k.jobTitle, statusText(k.status, k.scorerKind)].join(' · ');

/// The month a scorecard is of, as a title: "October 2026".
String monthTitle(KpiScorecard k) => monthNameOf(k.month);

/// A note shown when something couldn't load, with Try again.
class KpiLoadFailed extends StatelessWidget {
  const KpiLoadFailed({super.key, required this.text, required this.onRetry});

  final String text;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Notice(text: text, ok: false, action: KpiWords.tryAgain, onAction: onRetry);
}

/// A spinner where a card's content will be.
class KpiLoading extends StatelessWidget {
  const KpiLoading({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(32),
    child: Center(child: CircularProgressIndicator()),
  );
}
