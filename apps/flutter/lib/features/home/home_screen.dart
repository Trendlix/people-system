import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/me.dart';
import '../../models/today.dart';
import '../../platform/locator.dart';
import '../../providers.dart';
import '../../theme/tokens.dart';
import 'today_controller.dart';

/// Home's words, in one place (ready for Arabic).
abstract final class HomeWords {
  static const checkIn = 'Check in';
  static const checkOut = 'Check out';
  static const findingYou = 'Finding your location…';
  static const notYet = 'Not checked in yet';
  static String checkedIn(String at, String place) => 'Checked in at $at · $place';
  static String checkedOut(String at, String place) => 'Checked out at $at · $place';
  static String counted(String hours) => '$hours counted today';
  static String shift(String from, String to) => 'Shift $from – $to';
  static const sameAgain = 'Already done: kept once.';
  static const hold = 'Your access is on hold: you can still check in and out.';
  static const networkNeeded = 'Office network';
  static const wfh = 'Working from home';
  static const duty = 'Official duty';
  static const optional = 'Check-in optional today';
  static const signOut = 'Sign out';
  static const tryAgain = 'Try again';
  static const loadFailed = 'Couldn’t load today.';
  static const offerTitle = 'Sign in with your fingerprint?';
  static const offerBody = 'Next time, open the app and touch the sensor: no password.';
  static const offerYes = 'Use fingerprint';
  static const offerNo = 'Not now';
  static const fingerprintOn = 'Fingerprint sign-in is on.';

  static const places = {'office': 'Office', 'home': 'Home', 'remote': 'Remote', 'unknown': 'Location unknown'};

  static String placeOf(Punch p) {
    final place = places[p.place] ?? places['unknown']!;
    return p.place == 'remote' && p.locationName != null ? '$place · ${p.locationName}' : place;
  }

  static String noLocation(LocationProblem p) => switch (p) {
    LocationProblem.serviceOff => 'Your phone’s location is off. Turn it on to check in.',
    LocationProblem.denied => 'Trendlix People needs your location to check you in. Allow it when the phone asks.',
    LocationProblem.deniedForever => 'Location is blocked for Trendlix People. Allow it in the app’s settings to check in.',
    LocationProblem.timeout => 'Couldn’t find your location in time. Move near a window or outside, then try again.',
    LocationProblem.unavailable => 'Couldn’t read your location. Please try again.',
  };

  static String locationAction(LocationProblem p) => switch (p) {
    LocationProblem.serviceOff => 'Turn on location',
    LocationProblem.deniedForever => 'Open settings',
    _ => tryAgain,
  };
}

/// What Home says under the button after a press: good news, or why not and what to do.
typedef _Notice = ({String text, bool ok, String? action, VoidCallback? onAction});

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key, required this.me});

  final Me me;

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _busy = false;
  _Notice? _notice;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    // back in the app: the day as it is now
    _lifecycle = AppLifecycleListener(onResume: () => ref.invalidate(todayProvider));
    WidgetsBinding.instance.addPostFrameCallback((_) => _offerFingerprint());
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  Future<void> _offerFingerprint() async {
    final auth = ref.read(authProvider.notifier);
    final s = ref.read(authProvider).value;
    if (s is! SignedIn || !s.offerFingerprint || !mounted) return;
    auth.fingerprintOffered();
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.fingerprint_rounded, size: 40),
        title: const Text(HomeWords.offerTitle),
        content: const Text(HomeWords.offerBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(HomeWords.offerNo)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(HomeWords.offerYes)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (await auth.turnOnFingerprint()) messenger.showSnackBar(const SnackBar(content: Text(HomeWords.fingerprintOn)));
    } on FingerprintProblem catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _press() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    _Notice? notice;
    try {
      final outcome = await ref.read(todayProvider.notifier).press();
      switch (outcome) {
        case Pressed(:final punch, :final messages, :final kept):
          HapticFeedback.mediumImpact();
          final done = punch == null
              ? null
              : (punch.kind == PunchKind.checkIn ? HomeWords.checkedIn : HomeWords.checkedOut)(clockOf(punch.at), HomeWords.placeOf(punch));
          notice = (text: [if (!kept) HomeWords.sameAgain, ?done, ...messages].join('\n'), ok: true, action: null, onAction: null);
        case NoLocation(:final problem):
          final locator = ref.read(locatorProvider);
          final VoidCallback onAction = switch (problem) {
            LocationProblem.serviceOff => () => locator.openLocationSettings(),
            LocationProblem.deniedForever => () => locator.openAppSettings(),
            _ => _press,
          };
          notice = (text: HomeWords.noLocation(problem), ok: false, action: HomeWords.locationAction(problem), onAction: onAction);
      }
    } on ApiException catch (e) {
      notice = (text: e.message, ok: false, action: e.unreachable ? HomeWords.tryAgain : null, onAction: e.unreachable ? _press : null);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _notice = notice;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = ref.watch(todayProvider);
    final text = Theme.of(context).textTheme;
    final now = DateTime.now();
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(todayProvider.future),
          child: ListView(
            padding: Tokens.pagePadding,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${greetingAt(now)}, ${widget.me.firstName}', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w700, color: Tokens.ink)),
                        const SizedBox(height: 2),
                        Text(dayLineOf(now), style: text.bodyLarge?.copyWith(color: Tokens.muted)),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert_rounded),
                    onSelected: (_) => ref.read(authProvider.notifier).signOut(),
                    itemBuilder: (context) => const [PopupMenuItem(value: 'sign-out', child: Text(HomeWords.signOut))],
                  ),
                ],
              ),
              if (widget.me.hold) ...[const SizedBox(height: Tokens.gap), _Banner(text: HomeWords.hold, ok: false)],
              const SizedBox(height: Tokens.gap * 1.5),
              today.when(
                skipLoadingOnRefresh: true,
                loading: () => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
                error: (e, _) => _LoadFailed(message: e is ApiException ? e.message : HomeWords.loadFailed, onRetry: () => ref.invalidate(todayProvider)),
                data: (t) => _TodayView(today: t, busy: _busy, notice: _notice, onPress: _press),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TodayView extends StatelessWidget {
  const _TodayView({required this.today, required this.busy, required this.notice, required this.onPress});

  final Today today;
  final bool busy;
  final _Notice? notice;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final last = today.last;
    final status = last == null
        ? HomeWords.notYet
        : (last.kind == PunchKind.checkIn ? HomeWords.checkedIn : HomeWords.checkedOut)(clockOf(last.at), HomeWords.placeOf(last));
    final chips = [
      if (today.networkLocked) HomeWords.networkNeeded,
      if (today.workingFromHome) HomeWords.wfh,
      if (today.officialDutyNow) HomeWords.duty,
      if (today.exempt) HomeWords.optional,
    ];
    final refusal = today.refusal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(Tokens.gap + 4),
          decoration: BoxDecoration(color: Tokens.card, borderRadius: BorderRadius.circular(Tokens.radiusCard)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (today.shiftStart != null && today.shiftEnd != null)
                Text(HomeWords.shift(today.shiftStart!, today.shiftEnd!), style: text.labelLarge?.copyWith(color: Tokens.muted)),
              const SizedBox(height: 6),
              Text(refusal ?? status, style: text.titleMedium?.copyWith(color: Tokens.ink, fontWeight: FontWeight.w600)),
              if (refusal == null && today.hoursCounted > 0) ...[
                const SizedBox(height: 4),
                Text(HomeWords.counted(hoursOf(today.hoursCounted)), style: text.bodyMedium?.copyWith(color: Tokens.muted)),
              ],
              if (refusal == null && today.expectedText != null) ...[
                const SizedBox(height: 4),
                Text(today.expectedText!, style: text.bodyMedium?.copyWith(color: Tokens.muted)),
              ],
              if (refusal == null && chips.isNotEmpty) ...[
                const SizedBox(height: Tokens.gapSmall + 4),
                Wrap(spacing: Tokens.gapSmall, runSpacing: Tokens.gapSmall, children: [for (final c in chips) _Chip(c)]),
              ],
            ],
          ),
        ),
        if (refusal == null) ...[
          const SizedBox(height: Tokens.gap * 2.5),
          Center(child: _PressButton(next: today.next, busy: busy, onPress: onPress)),
          const SizedBox(height: Tokens.gap * 2),
        ],
        if (notice != null) _Banner(text: notice!.text, ok: notice!.ok, action: notice!.action, onAction: notice!.onAction),
      ],
    );
  }
}

/// The one big button: Check in (accent) or Check out (ink), whichever is next.
class _PressButton extends StatelessWidget {
  const _PressButton({required this.next, required this.busy, required this.onPress});

  final PunchKind next;
  final bool busy;
  final VoidCallback onPress;

  static const size = 196.0;

  @override
  Widget build(BuildContext context) {
    final checkIn = next == PunchKind.checkIn;
    final colour = checkIn ? Tokens.accent : Tokens.ink;
    final label = checkIn ? HomeWords.checkIn : HomeWords.checkOut;
    return Semantics(
      button: true,
      label: busy ? HomeWords.findingYou : label,
      child: Material(
        color: colour,
        shape: const CircleBorder(),
        elevation: 6,
        shadowColor: colour.withValues(alpha: 0.45),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: busy ? null : onPress,
          child: SizedBox.square(
            dimension: size,
            child: Center(
              child: busy
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox.square(dimension: 32, child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white)),
                        const SizedBox(height: 12),
                        Text(HomeWords.findingYou, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.white)),
                      ],
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(checkIn ? Icons.login_rounded : Icons.logout_rounded, color: Colors.white, size: 44),
                        const SizedBox(height: 10),
                        Text(label, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700)),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: Tokens.accentSoft, borderRadius: BorderRadius.circular(Tokens.radiusPill)),
      child: Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: Tokens.accent, fontWeight: FontWeight.w600)),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.ok, this.action, this.onAction});

  final String text;
  final bool ok;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final fg = ok ? Tokens.ok : Tokens.danger;
    return Container(
      padding: const EdgeInsets.all(Tokens.gap),
      decoration: BoxDecoration(color: ok ? Tokens.okSoft : Tokens.dangerSoft, borderRadius: BorderRadius.circular(Tokens.radiusControl)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(ok ? Icons.check_circle_rounded : Icons.info_rounded, color: fg),
              const SizedBox(width: Tokens.gapSmall + 2),
              Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: fg))),
            ],
          ),
          if (action != null && onAction != null)
            Align(alignment: Alignment.centerRight, child: TextButton(onPressed: onAction, child: Text(action!))),
        ],
      ),
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => _Banner(text: message, ok: false, action: HomeWords.tryAgain, onAction: onRetry);
}
