import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../platform/biometrics.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import 'auth_controller.dart';

/// The app lock's words, in one place (ready for Arabic).
abstract final class LockWords {
  static const eyebrow = 'Trendlix People';
  static const title = 'Locked';
  static const intro = 'Use your fingerprint or face to open Trendlix People.';
  static const reason = 'Unlock Trendlix People';
  static const unlock = 'Unlock';
  static const signOut = 'Sign out';
  static const lockedOut = 'Too many tries. Unlock your phone, then try again, or sign out and sign in with your password.';
  static const unavailable = 'The fingerprint isn’t available right now. Sign out, then sign in with your password.';
}

/// The app locked behind the fingerprint or face (owner, 31 October 2026: "when the app is closed and reopened, ask for
/// the fingerprint or the faceid again, as a security step"): locked whenever it opens with a session kept, and when it
/// comes back after a minute or more away (another app, the screen off); a quick switch doesn't lock it. Signing in
/// (the password, a code, the fingerprint) proves it's them, so it opens unlocked then. A phone with no fingerprint or
/// face set up can't be asked: it opens as before.
final appLockProvider = NotifierProvider<AppLockController, bool>(AppLockController.new);

class AppLockController extends Notifier<bool> with WidgetsBindingObserver {
  /// How long away locks the app again.
  static const awayLimit = Duration(minutes: 1);

  /// The clock (tests set their own).
  static DateTime Function() now = DateTime.now;

  DateTime? _away;

  @override
  bool build() {
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() => WidgetsBinding.instance.removeObserver(this));
    // the app has just opened: locked until the fingerprint, or a sign-in, proves it's them
    return true;
  }

  void unlock() => state = false;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused || AppLifecycleState.hidden:
        _away ??= now();
      case AppLifecycleState.resumed:
        final away = _away;
        _away = null;
        if (away != null && now().difference(away) >= awayLimit) this.state = true;
      default:
    }
  }
}

/// Above the whole app (MaterialApp's builder): the app itself while unlocked or signed out; the lock screen in its place
/// while locked, the app kept as it was underneath (out of sight).
class AppLockGate extends ConsumerWidget {
  const AppLockGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(authProvider).value is SignedIn;
    final locked = ref.watch(appLockProvider);
    if (!signedIn || !locked) return child;
    return Stack(
      children: [
        Offstage(child: child),
        const Positioned.fill(child: LockScreen()),
      ],
    );
  }
}

class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  bool _asking = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    // asked at once, as the app opens
    WidgetsBinding.instance.addPostFrameCallback((_) => _ask(first: true));
  }

  Future<void> _ask({bool first = false}) async {
    if (_asking) return;
    final biometrics = ref.read(biometricsProvider);
    if (first && !await biometrics.available()) {
      // nothing to ask with on this phone: open as before
      ref.read(appLockProvider.notifier).unlock();
      return;
    }
    setState(() {
      _asking = true;
      _problem = null;
    });
    final outcome = await biometrics.confirm(LockWords.reason);
    if (!mounted) return;
    setState(() => _asking = false);
    switch (outcome) {
      case FingerprintOutcome.confirmed:
        ref.read(appLockProvider.notifier).unlock();
      case FingerprintOutcome.cancelled:
        break;
      case FingerprintOutcome.lockedOut:
        setState(() => _problem = LockWords.lockedOut);
      case FingerprintOutcome.unavailable:
        setState(() => _problem = LockWords.unavailable);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: p.canvas,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(alignment: AlignmentDirectional.centerStart, child: Wordmark(height: 28, forDark: p.isDark)),
              const Spacer(),
              Center(child: Icon(CupertinoIcons.lock_shield, size: 56, color: p.ink)),
              const SizedBox(height: 20),
              const Center(child: Eyebrow(LockWords.eyebrow)),
              const SizedBox(height: 8),
              Text(LockWords.title, textAlign: TextAlign.center, style: text.displaySmall),
              const SizedBox(height: 10),
              Text(LockWords.intro, textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: p.muted)),
              if (_problem != null) ...[const SizedBox(height: 18), Notice(text: _problem!, ok: false)],
              const Spacer(),
              SizedBox(
                height: Tokens.buttonHeight,
                child: FilledButton.icon(
                  onPressed: _asking ? null : () => _ask(),
                  icon: const Icon(CupertinoIcons.lock_open, size: 20),
                  label: const Text(LockWords.unlock),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(onPressed: _asking ? null : () => ref.read(authProvider.notifier).signOut(), child: const Text(LockWords.signOut)),
            ],
          ),
        ),
      ),
    );
  }
}
