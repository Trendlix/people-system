import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/requests.dart';
import '../../models/timesheet.dart';
import '../../notifications/popup_memory.dart';
import '../../theme/parts.dart';
import '../timesheet/timesheet_data.dart';
import '../timesheet/timesheet_week_page.dart';
import 'approvals.dart' show ApproveWords;
import 'history.dart';
import 'request_page.dart';
import 'requests_data.dart';

// What waits for the person's decision, in a popup (owner, 8 November 2026: "when there is a pending request make it to
// popup in the mobile app and gives a push notification once requested"): the requests and weeks of hours To approve
// lists (approvals.dart), when the app opens, when it comes back, and as soon as a new one is sent (its push, or the
// bell's count going up). A request shows once when it comes; the lot again the next day while they still wait. Review
// opens the one request, or To approve on the Requests tab for more; Later closes it.

abstract final class WaitingWords {
  static String title(int n) => n == 1 ? 'A request is waiting for you' : '$n requests are waiting for you';
  static const line = 'They need your approval.';
  static String more(int n) => 'And $n more on Requests.';
  static const later = 'Later';
  static const review = 'Review';
}

/// The day as the popup remembers it: the phone's date, yyyy-mm-dd.
String popupDay(DateTime now) => '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

/// Whether the popup shows: something waits that it hasn't shown yet, or it last showed on another day (or to someone
/// else on this phone).
bool waitingPopupDue({required Set<String> waiting, required PopupShown? last, required String userId, required String today}) {
  if (waiting.isEmpty) return false;
  if (last == null || last.userId != userId || last.day != today) return true;
  return !last.keys.containsAll(waiting);
}

String _weekKey(TimesheetListItem w) => 'timesheet:${w.id}';

/// Where the popup shows now, if it does: one at a time. A frame that went (signed out under it) no longer counts.
BuildContext? _showing;
Object? _turn;

/// Reads what waits (fresh) and shows the popup when it is due. Quiet when People can't be reached. True: it showed.
Future<bool> showWaitingPopup(BuildContext context, WidgetRef ref, {required String userId, DateTime? now}) async {
  if (_showing?.mounted ?? false) return false;
  final turn = _turn = Object();
  _showing = context;
  // kept alive while read (the Requests tab's card reads the same, and shows the new ones too)
  final keepRequests = ref.listenManual(waitingRequestsProvider, (_, _) {});
  final keepWeeks = ref.listenManual(waitingTimesheetsProvider, (_, _) {});
  try {
    ref
      ..invalidate(waitingRequestsProvider)
      ..invalidate(waitingTimesheetsProvider);
    final List<PeopleRequest> requests;
    final List<TimesheetListItem> weeks;
    try {
      requests = (await ref.read(waitingRequestsProvider.future)).items;
      weeks = await ref.read(waitingTimesheetsProvider.future).catchError((Object _) => const <TimesheetListItem>[]);
    } catch (_) {
      return false;
    }
    if (!context.mounted) return false;
    final keys = {for (final r in requests) requestKeyOf(r), for (final w in weeks) _weekKey(w)};
    final memory = ref.read(popupMemoryProvider);
    final today = popupDay(now ?? DateTime.now());
    if (!waitingPopupDue(waiting: keys, last: await memory.read(), userId: userId, today: today) || !context.mounted) return false;
    await memory.write((userId: userId, day: today, keys: keys));
    if (!context.mounted) return false;
    HapticFeedback.mediumImpact();
    final review = await showDialog<bool>(
      context: context,
      builder: (c) => _WaitingDialog(requests: requests, weeks: weeks),
    );
    if (review != true || !context.mounted) return true;
    if (requests.length == 1 && weeks.isEmpty) {
      final r = requests.single;
      await Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: r.kind, id: r.id, initial: r)));
    } else if (requests.isEmpty && weeks.length == 1) {
      await Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => TimesheetWeekPage(id: weeks.single.id)));
    } else {
      GoRouter.of(context).go('/requests');
    }
    return true;
  } finally {
    keepRequests.close();
    keepWeeks.close();
    if (identical(_turn, turn)) _showing = null;
  }
}

class _WaitingDialog extends StatelessWidget {
  const _WaitingDialog({required this.requests, required this.weeks});

  final List<PeopleRequest> requests;
  final List<TimesheetListItem> weeks;

  static const _shown = 4;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final n = requests.length + weeks.length;
    final rows = <(IconData, String, String)>[
      for (final r in requests)
        (
          kindIcons[r.kind] ?? CupertinoIcons.doc_text,
          r.employeeName,
          () {
            final row = historyRowOf(r);
            return [row.title, if (row.when.isNotEmpty) row.when].join(' · ');
          }(),
        ),
      for (final w in weeks) (CupertinoIcons.timer, w.employeeName, ApproveWords.weekLine(w.weekStart, w.weekEnd, w.totalHours)),
    ];
    return AlertDialog(
      icon: const Icon(CupertinoIcons.bell, size: 36),
      title: Text(WaitingWords.title(n)),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            const Text(WaitingWords.line),
            const SizedBox(height: 12),
            for (final (icon, name, line) in rows.take(_shown))
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    IconTile(icon),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: text.labelMedium),
                          const SizedBox(height: 2),
                          Text(line, style: text.bodySmall),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            if (n > _shown) Text(WaitingWords.more(n - _shown), style: text.bodySmall),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(WaitingWords.later)),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(WaitingWords.review)),
      ],
    );
  }
}
