import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/requests/requests_data.dart' show requestsChanged;
import '../features/requests/waiting_popup.dart';
import '../features/timesheet/timesheet_data.dart' show timesheetsChanged;
import '../notifications/open.dart';
import '../notifications/places.dart';
import '../notifications/push_center.dart';
import '../platform/push.dart';
import 'notifications.dart';
import 'shell_words.dart';

// While signed in (owner, 8 November 2026: "notifications are not working correctly, and when there is a pending request
// make it to popup in the mobile app and gives a push notification once requested"):
// - a push that comes while the app is open: something waiting for them, the "waiting for you" popup at once
//   (waiting_popup.dart); anything else, a message at the foot with Open; the bell's count and the lists refreshed;
// - a push tapped on the phone: its screen opened, marked read (notifications/open.dart); one the app has no screen for
//   opens the bell's list;
// - the app back in front, and every minute while it is: the bell's count read again; when it goes up, something new
//   came (also on a phone with no push), so the popup looks again; on a new day, too, it shows what still waits.
// The start (asking the phone, the push that opened the app, the first popup) is AppShell's, in turn with its other
// popups: startPush().

/// How often the bell's count is read again while the app is in front.
const bellEvery = Duration(minutes: 1);

class PushListener extends ConsumerStatefulWidget {
  const PushListener({super.key, required this.userId, required this.child});

  final String userId;
  final Widget child;

  @override
  ConsumerState<PushListener> createState() => _PushListenerState();
}

class _PushListenerState extends ConsumerState<PushListener> with WidgetsBindingObserver {
  final _subs = <StreamSubscription<PushMessage>>[];
  Timer? _timer;
  bool _front = true;
  String _day = popupDay(DateTime.now());

  @override
  void initState() {
    super.initState();
    final push = ref.read(pushProvider);
    _subs
      ..add(push.received.listen(_received))
      ..add(push.opened.listen(_opened));
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(bellEvery, (_) {
      if (_front) _bell();
    });
    // the bell's count up: something new came
    ref.listenManual<AsyncValue<int?>>(unreadProvider, (before, now) {
      final was = before?.value, n = now.value;
      if (was != null && n != null && n > was) _lookAgain();
    });
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_front) return;
      _front = true;
      _bell();
      final today = popupDay(DateTime.now());
      if (today != _day) {
        _day = today;
        _lookAgain();
      }
    } else if (state == AppLifecycleState.hidden || state == AppLifecycleState.paused) {
      _front = false;
    }
  }

  void _bell() => ref.invalidate(unreadProvider);

  /// Something new may wait for them: the popup looks (it shows only what it hasn't).
  void _lookAgain() {
    if (!mounted) return;
    unawaited(showWaitingPopup(context, ref, userId: widget.userId));
  }

  Future<void> _received(PushMessage m) async {
    if (!mounted) return;
    ref
      ..invalidate(unreadProvider)
      ..invalidate(inboxProvider);
    requestsChanged(ref);
    timesheetsChanged(ref);
    // waiting for them: the popup (else, as when it already shows, the message below)
    if (popupKinds.contains(m.kind) && await showWaitingPopup(context, ref, userId: widget.userId)) return;
    if (m.title.isEmpty || !mounted) return;
    final place = placeOf(m.link, m.kind);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(m.body.isEmpty ? m.title : '${m.title}\n${m.body}'),
        duration: const Duration(seconds: 6),
        action: place == null ? null : SnackBarAction(label: ShellWords.open, onPressed: () => openNotification(context, id: m.id, link: m.link, kind: m.kind)),
      ),
    );
  }

  void _opened(PushMessage m) {
    if (!mounted) return;
    openPushed(context, m);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// A push tapped: its screen, marked read; without one, the bell's list (it marked read too).
void openPushed(BuildContext context, PushMessage m) {
  if (openNotification(context, id: m.id, link: m.link, kind: m.kind)) return;
  unawaited(showNotifications(context));
}

/// AppShell's turn (after the fingerprint's offer): the phone asked once and registered; then the push that opened the
/// app, if one did. True: a push opened something (the popups after it wait for another time).
Future<bool> startPush(BuildContext context, WidgetRef ref) async {
  await ref.read(pushCenterProvider).signedIn();
  final launched = await ref.read(pushProvider).launchedWith();
  if (launched == null || !context.mounted) return false;
  openPushed(context, launched);
  return true;
}
