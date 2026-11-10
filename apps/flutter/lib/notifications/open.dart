import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/requests/request_page.dart';
import '../features/timesheet/timesheet_week_page.dart';
import '../platform/update_gate.dart' show linkOpenerProvider;
import '../providers.dart';
import '../shell/notifications.dart';
import 'places.dart';

// Opening a notification, from the bell's list or a push tapped on the phone (owner, 8 November 2026: "opened
// notifications should be marked read"): marked read on People (POST /api/me/notifications/:id/read; the bell's count
// goes down), then its screen opened (places.dart), or its page on the website in the phone's browser when the app has
// no screen for it (10 November 2026). One without a link is only marked read.

/// Marks the notification read, quietly (People unreachable: it stays unread, as on the website). Given the app's
/// container, as the bell's sheet that asks may close meanwhile.
Future<void> markNotificationRead(ProviderContainer app, String id) async {
  if (id.isEmpty) return;
  try {
    await app.read(peopleClientProvider).post('/api/me/notifications/${Uri.encodeComponent(id)}/read');
  } catch (_) {
    return;
  }
  app
    ..invalidate(unreadProvider)
    ..invalidate(inboxProvider);
}

/// Opens [place]: a request or a week over the app, a tab or a screen by its address, a page of the website in the
/// phone's browser ([openLink]).
void openPlace(NotificationPlace place, {required NavigatorState navigator, required GoRouter router, required Future<bool> Function(Uri) openLink}) {
  switch (place) {
    case RequestPlace(:final kind, :final id):
      navigator.push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: kind, id: id)));
    case WeekPlace(:final id):
      navigator.push(MaterialPageRoute<void>(builder: (_) => TimesheetWeekPage(id: id)));
    case ScreenPlace(:final path):
      router.go(path);
    case WebsitePlace(:final uri):
      // not waited for; a phone that can't open it keeps the notification read in the list
      unawaited(openLink(uri).then((_) {}, onError: (Object _) {}));
  }
}

/// Opens a notification from where [context] is: marked read, then its screen or its page on the website. False: it has
/// no link.
bool openNotification(BuildContext context, {required String id, required String link, required String kind}) {
  final app = ProviderScope.containerOf(context, listen: false);
  final navigator = Navigator.of(context, rootNavigator: true);
  final router = GoRouter.of(context);
  final place = placeOf(link, kind);
  // not waited for: the screen opens at once
  unawaited(markNotificationRead(app, id));
  if (place == null) return false;
  openPlace(place, navigator: navigator, router: router, openLink: app.read(linkOpenerProvider));
  return true;
}
