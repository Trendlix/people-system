import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../format.dart';
import '../../models/today.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../today/check_in_words.dart';
import '../today/press_flow.dart';
import '../today/today_controller.dart';

/// The Dashboard's "Today's shift" (the phone design, 30 October 2026): the one dark card (light on the dark look) with
/// where the day stands, the shift, the time large (the clock before checking in, the time worked after), where, and the
/// one button. What a press came to shows under it.
class ShiftCard extends ConsumerStatefulWidget {
  const ShiftCard({super.key});

  @override
  ConsumerState<ShiftCard> createState() => _ShiftCardState();
}

class _ShiftCardState extends ConsumerState<ShiftCard> with CheckInPress {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // the large time moves on with the minute
    _tick = Timer.periodic(const Duration(seconds: 20), (_) => mounted ? setState(() {}) : null);
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final today = ref.watch(todayProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        today.when(
          skipLoadingOnRefresh: true,
          loading: () => const _Frame(
            child: SizedBox(height: 220, child: Center(child: CircularProgressIndicator())),
          ),
          error: (e, _) => Notice(
            text: e is ApiException ? e.message : CheckInWords.loadFailed,
            ok: false,
            action: CheckInWords.tryAgain,
            onAction: () => ref.invalidate(todayProvider),
          ),
          data: (t) => _Card(today: t, busy: pressing, onPress: press),
        ),
        if (notice case final n?) ...[const SizedBox(height: 12), Notice(text: n.text, ok: n.ok, action: n.action, onAction: n.onAction)],
      ],
    );
  }
}

class _Frame extends StatelessWidget {
  const _Frame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: p.inverse,
        borderRadius: BorderRadius.circular(Tokens.radiusCard),
        gradient: RadialGradient(center: const Alignment(0.9, -1), radius: 1.2, colors: [Color.lerp(p.inverse, p.onInverse, 0.1)!, p.inverse]),
        boxShadow: const [BoxShadow(color: Color(0x29000000), offset: Offset(0, 24), blurRadius: 60)],
      ),
      child: child,
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.today, required this.busy, required this.onPress});

  final Today today;
  final bool busy;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final last = today.last;
    final open = today.openSince != null;
    final status = last == null
        ? CheckInWords.readyToStart
        : (last.kind == PunchKind.checkIn ? CheckInWords.statusIn : CheckInWords.statusOut)(clockOf(last.at));
    final worked = today.workedAt(DateTime.now());
    final big = last == null ? clockOf(DateTime.now()) : workClockOf(worked);
    final where = last != null ? CheckInWords.placeOf(last) : today.expectedText;
    final notes = CheckInWords.notes(today);
    final muted = text.bodyMedium?.copyWith(color: p.inverseMuted);
    return _Frame(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('TODAY’S SHIFT', style: text.labelSmall?.copyWith(color: p.inverseMuted)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: open ? const Color(0xFF5CC8B5) : p.inverseMuted),
                        ),
                        const SizedBox(width: 8),
                        Flexible(child: Text(today.refusal == null ? status : CheckInWords.notYet, style: muted)),
                      ],
                    ),
                  ],
                ),
              ),
              Icon(CupertinoIcons.clock, size: 24, color: p.onInverse),
            ],
          ),
          const SizedBox(height: 30),
          if (today.refusal != null)
            Text(today.refusal!, style: text.bodyLarge?.copyWith(color: p.onInverse))
          else ...[
            if (today.shiftStart != null && today.shiftEnd != null) Text(CheckInWords.shift(today.shiftStart!, today.shiftEnd!), style: muted),
            const SizedBox(height: 4),
            if (last != null) Text(CheckInWords.workedToday, style: muted),
            Text(
              big,
              style: text.displayMedium?.copyWith(
                color: p.onInverse,
                fontSize: 64,
                letterSpacing: -4.2,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            if (where != null) ...[const SizedBox(height: 10), Text(where, style: muted)],
            if (notes.isNotEmpty) ...[const SizedBox(height: 4), Text(notes.join(' · '), style: muted)],
            const SizedBox(height: 22),
            _PressButton(next: today.next, busy: busy, onPress: onPress),
          ],
        ],
      ),
    );
  }
}

/// The card's button: light on the dark card (dark on the light one), "Check in for work →" or "Check out →".
class _PressButton extends StatelessWidget {
  const _PressButton({required this.next, required this.busy, required this.onPress});

  final PunchKind next;
  final bool busy;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final fg = p.inverse;
    final label = next == PunchKind.checkIn ? CheckInWords.checkInForWork : CheckInWords.checkOut;
    return Semantics(
      button: true,
      label: busy ? CheckInWords.findingYou : label,
      excludeSemantics: true,
      child: Material(
        color: p.onInverse,
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          onTap: busy ? null : onPress,
          borderRadius: BorderRadius.circular(15),
          child: SizedBox(
            height: 58,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Row(
                children: [
                  if (busy)
                    SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                  else
                    Icon(next == PunchKind.checkIn ? CupertinoIcons.clock : CupertinoIcons.square_arrow_left, size: 19, color: fg),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(busy ? CheckInWords.findingYou : label, style: text.labelLarge?.copyWith(color: fg)),
                  ),
                  Icon(CupertinoIcons.arrow_right, size: 18, color: fg),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
