import 'package:flutter/cupertino.dart' show CupertinoIcons;
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
import '../../theme/look.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'today_controller.dart';
import 'work_ring.dart';

/// Home's words, in one place (ready for Arabic).
abstract final class HomeWords {
  static const checkIn = 'Check in';
  static const checkOut = 'Check out';
  static const findingYou = 'Finding your location…';
  static const notYet = 'Not checked in';
  static const attention = 'Here’s what needs your attention today.';
  static const today = 'Today';
  static const record = 'Today’s record';
  static const recordTitle = 'Check-ins';
  static const privacy = 'Your location is only captured when you check in or out.';
  static String statusIn(String at) => 'Checked in · $at';
  static String statusOut(String at) => 'Checked out · $at';
  static String checkedIn(String at, String place) => 'Checked in at $at · $place';
  static String checkedOut(String at, String place) => 'Checked out at $at · $place';
  static String shift(String from, String to) => 'Shift $from – $to';
  static const sameAgain = 'Already done: kept once.';
  static const hold = 'Your access is on hold: you can still check in and out.';
  static const networkNeeded = 'Office network';
  static const wfh = 'Working from home';
  static const duty = 'Official duty';
  static const optional = 'Check-in optional today';
  static const signOut = 'Sign out';
  static const account = 'Your account';
  static const toDark = 'Dark look';
  static const toLight = 'Light look';
  static const tryAgain = 'Try again';
  static const loadFailed = 'Couldn’t load today.';
  static const offerTitle = 'Sign in with your fingerprint?';
  static const offerBody = 'Next time, open the app and touch the sensor: no password.';
  static const offerYes = 'Use fingerprint';
  static const offerNo = 'Not now';
  static const fingerprintOn = 'Fingerprint sign-in is on.';
  static const kindIn = 'Checked in';
  static const kindOut = 'Checked out';

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
typedef _Said = ({String text, bool ok, String? action, VoidCallback? onAction});

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key, required this.me});

  final Me me;

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _busy = false;
  _Said? _said;
  final _saidKey = GlobalKey();
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
      _said = null;
    });
    _Said? said;
    try {
      final outcome = await ref.read(todayProvider.notifier).press();
      switch (outcome) {
        case Pressed(:final punch, :final messages, :final kept):
          HapticFeedback.mediumImpact();
          final done = punch == null
              ? null
              : (punch.kind == PunchKind.checkIn ? HomeWords.checkedIn : HomeWords.checkedOut)(clockOf(punch.at), HomeWords.placeOf(punch));
          said = (text: [if (!kept) HomeWords.sameAgain, ?done, ...messages].join('\n'), ok: true, action: null, onAction: null);
        case NoLocation(:final problem):
          final locator = ref.read(locatorProvider);
          final VoidCallback onAction = switch (problem) {
            LocationProblem.serviceOff => () => locator.openLocationSettings(),
            LocationProblem.deniedForever => () => locator.openAppSettings(),
            _ => _press,
          };
          said = (text: HomeWords.noLocation(problem), ok: false, action: HomeWords.locationAction(problem), onAction: onAction);
      }
    } on ApiException catch (e) {
      said = (text: e.message, ok: false, action: e.unreachable ? HomeWords.tryAgain : null, onAction: e.unreachable ? _press : null);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _said = said;
        });
        // what the press came to, in view (on a short phone it can fall under the screen's edge)
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final shown = _saidKey.currentContext;
          if (shown != null && shown.mounted) {
            Scrollable.ensureVisible(
              shown,
              duration: const Duration(milliseconds: 250),
              alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
            );
          }
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
              _Header(me: widget.me),
              const SizedBox(height: 28),
              Eyebrow(eyebrowDayOf(now)),
              const SizedBox(height: 8),
              Text('${greetingAt(now)}, ${widget.me.firstName}.', style: text.displaySmall),
              const SizedBox(height: 8),
              Text(HomeWords.attention, style: text.bodyMedium?.copyWith(color: context.palette.muted)),
              if (widget.me.hold) ...[const SizedBox(height: Tokens.gap), const Notice(text: HomeWords.hold, ok: false)],
              const SizedBox(height: 24),
              today.when(
                skipLoadingOnRefresh: true,
                loading: () => const Padding(
                  padding: EdgeInsets.all(48),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (e, _) => Notice(
                  text: e is ApiException ? e.message : HomeWords.loadFailed,
                  ok: false,
                  action: HomeWords.tryAgain,
                  onAction: () => ref.invalidate(todayProvider),
                ),
                data: (t) => _TodayView(today: t, now: now, busy: _busy, said: _said, saidKey: _saidKey, onPress: _press),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The design's header, for a phone: the app's name; the light/dark switch; the avatar, with the account's menu.
class _Header extends ConsumerWidget {
  const _Header({required this.me});

  final Me me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final dark = p.isDark;
    return Row(
      children: [
        const Expanded(
          child: Align(alignment: AlignmentDirectional.centerStart, child: BrandLine()),
        ),
        IconTile(
          dark ? CupertinoIcons.sun_max : CupertinoIcons.moon,
          onCard: false,
          tooltip: dark ? HomeWords.toLight : HomeWords.toDark,
          onTap: () => ref.read(lookProvider.notifier).toggle(p.brightness),
        ),
        PopupMenuButton<String>(
          tooltip: HomeWords.account,
          position: PopupMenuPosition.under,
          onSelected: (_) => ref.read(authProvider.notifier).signOut(),
          itemBuilder: (context) => [
            PopupMenuItem(
              value: 'sign-out',
              child: Row(
                children: [
                  Icon(CupertinoIcons.square_arrow_left, size: 18, color: p.ink),
                  const SizedBox(width: 10),
                  const Text(HomeWords.signOut),
                ],
              ),
            ),
          ],
          child: SizedBox.square(
            dimension: Tokens.tapTarget,
            child: Center(
              child: Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: p.primary,
                  shape: BoxShape.circle,
                  border: Border.all(color: p.line),
                ),
                child: Text(
                  initialsOf(me.name ?? me.firstName),
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(color: p.onPrimary, fontWeight: FontWeight.w600),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _TodayView extends StatelessWidget {
  const _TodayView({required this.today, required this.now, required this.busy, required this.said, required this.saidKey, required this.onPress});

  final Today today;
  final DateTime now;
  final bool busy;
  final _Said? said;
  final GlobalKey saidKey;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final last = today.last;
    final refusal = today.refusal;
    final status = last == null ? HomeWords.notYet : (last.kind == PunchKind.checkIn ? HomeWords.statusIn : HomeWords.statusOut)(clockOf(last.at));
    final chips = [
      if (today.networkLocked) (HomeWords.networkNeeded, CupertinoIcons.wifi),
      if (today.workingFromHome) (HomeWords.wfh, CupertinoIcons.house),
      if (today.officialDutyNow) (HomeWords.duty, CupertinoIcons.briefcase),
      if (today.exempt) (HomeWords.optional, CupertinoIcons.checkmark_alt),
    ];
    final said = this.said;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CardHead(
                eyebrow: HomeWords.today,
                title: dayLineOf(now),
                trailing: refusal == null ? Pill(status, strong: last?.kind == PunchKind.checkIn) : null,
              ),
              if (refusal != null) ...[
                const SizedBox(height: Tokens.gap),
                Text(refusal, style: text.bodyLarge),
              ] else ...[
                const SizedBox(height: 24),
                Center(child: WorkRing(today: today)),
                const SizedBox(height: 24),
                if (today.shiftStart != null && today.shiftEnd != null)
                  Text(HomeWords.shift(today.shiftStart!, today.shiftEnd!), style: text.titleMedium),
                if (today.expectedText != null) ...[
                  const SizedBox(height: 4),
                  Text(today.expectedText!, style: text.bodyMedium?.copyWith(color: p.muted)),
                ],
                if (chips.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: Tokens.gapSmall,
                    runSpacing: Tokens.gapSmall,
                    children: [for (final (label, icon) in chips) Pill(label, icon: icon)],
                  ),
                ],
                const SizedBox(height: 20),
                _PressButton(next: today.next, busy: busy, onPress: onPress),
                // what the press came to, right under it
                if (said != null) ...[
                  const SizedBox(height: 12),
                  Notice(key: saidKey, text: said.text, ok: said.ok, action: said.action, onAction: said.onAction),
                ],
                const SizedBox(height: 12),
                Text(HomeWords.privacy, textAlign: TextAlign.center, style: text.bodySmall),
              ],
            ],
          ),
        ),
        if (refusal == null && today.punches.isNotEmpty) ...[const SizedBox(height: 12), _Record(punches: today.punches)],
      ],
    );
  }
}

/// The one big button: Check in or Check out, whichever is next.
class _PressButton extends StatelessWidget {
  const _PressButton({required this.next, required this.busy, required this.onPress});

  final PunchKind next;
  final bool busy;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final checkIn = next == PunchKind.checkIn;
    return SizedBox(
      height: 58,
      child: FilledButton(
        onPressed: busy ? null : onPress,
        style: FilledButton.styleFrom(textStyle: Theme.of(context).textTheme.titleMedium),
        child: busy
            ? Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: p.onPrimary)),
                  const SizedBox(width: 12),
                  const Text(HomeWords.findingYou),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(checkIn ? CupertinoIcons.clock : CupertinoIcons.square_arrow_left, size: 20, color: p.onPrimary),
                  const SizedBox(width: 10),
                  Text(checkIn ? HomeWords.checkIn : HomeWords.checkOut),
                ],
              ),
      ),
    );
  }
}

/// Today's check-ins and check-outs, as the design's schedule lists times: the time, a dot on a line, what and where.
class _Record extends StatelessWidget {
  const _Record({required this.punches});

  final List<Punch> punches;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const CardHead(eyebrow: HomeWords.record, title: HomeWords.recordTitle),
          const SizedBox(height: 12),
          for (final (i, punch) in punches.indexed)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 48,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(clockOf(punch.at), style: text.bodySmall),
                    ),
                  ),
                  SizedBox(
                    width: 24,
                    child: Column(
                      children: [
                        Container(width: 1, height: 14, color: i == 0 ? Colors.transparent : p.line),
                        Icon(
                          punch.kind == PunchKind.checkIn ? CupertinoIcons.largecircle_fill_circle : CupertinoIcons.circle,
                          size: 14,
                          color: p.ink,
                        ),
                        Expanded(child: Container(width: 1, color: i == punches.length - 1 ? Colors.transparent : p.line)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(punch.kind == PunchKind.checkIn ? HomeWords.kindIn : HomeWords.kindOut, style: text.bodyLarge),
                          Text(HomeWords.placeOf(punch), style: text.bodySmall),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
