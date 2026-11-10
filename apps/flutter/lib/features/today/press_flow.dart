import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../format.dart';
import '../../models/today.dart';
import '../../platform/locator.dart';
import '../../platform/location_pings.dart';
import '../../providers.dart';
import 'check_in_words.dart';
import 'today_controller.dart';

// One press of Check in / Check out, for whichever screen shows the button (the Dashboard's shift card, the Attendance
// tab's Today panel): busy while the spot is read and sent, then what it came to, good news or why not and what to do.
// While the company has the hourly location on, a check-in on Android waits for "Allow all the time" (owner, 10 November
// 2026: "make sure that the location should be always on for the hourly ping"): what it reads and why first, then the
// phone's prompt or the app's settings; not allowed, no check-in, and what to choose.

/// What a press came to, in words to show: good news, or a problem with the way to fix it.
typedef PressNotice = ({String text, bool ok, String? action, VoidCallback? onAction});

mixin CheckInPress<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  bool pressing = false;
  PressNotice? notice;

  Future<void> press() async {
    if (pressing) return;
    setState(() {
      pressing = true;
      notice = null;
    });
    PressNotice? said;
    try {
      final today = ref.read(todayProvider).value;
      if (today != null && needsAlwaysToCheckIn(today)) {
        final locator = ref.read(locatorProvider);
        if (!await locator.allowedAllTheTime()) {
          if (!mounted || !await showPingDisclosure(context)) {
            said = (text: PingWords.needAlways, ok: false, action: PingWords.allowAlways, onAction: press);
            return;
          }
          if (!await locator.askAllTheTime()) {
            said = (text: PingWords.inSettings, ok: false, action: CheckInWords.checkIn, onAction: press);
            return;
          }
        }
      }
      final outcome = await ref.read(todayProvider.notifier).press();
      switch (outcome) {
        case Pressed(:final punch, :final messages, :final kept):
          HapticFeedback.mediumImpact();
          final done = punch == null
              ? null
              : (punch.kind == PunchKind.checkIn ? CheckInWords.checkedIn : CheckInWords.checkedOut)(clockOf(punch.at), CheckInWords.placeOf(punch));
          said = (text: [if (!kept) CheckInWords.sameAgain, ?done, ...messages].join('\n'), ok: true, action: null, onAction: null);
        case NoLocation(:final problem):
          final locator = ref.read(locatorProvider);
          final VoidCallback onAction = switch (problem) {
            LocationProblem.serviceOff => () => locator.openLocationSettings(),
            LocationProblem.deniedForever => () => locator.openAppSettings(),
            _ => press,
          };
          said = (text: CheckInWords.noLocation(problem), ok: false, action: CheckInWords.locationAction(problem), onAction: onAction);
      }
    } on ApiException catch (e) {
      said = (text: e.message, ok: false, action: e.unreachable ? CheckInWords.tryAgain : null, onAction: e.unreachable ? press : null);
    } finally {
      if (mounted) {
        setState(() {
          pressing = false;
          notice = said;
        });
      }
    }
  }
}
