import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../notifications/open.dart';
import '../notifications/places.dart';
import '../providers.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import 'shell_words.dart';

// The bell's count and the inbox (GET /api/me/notifications/unread-count and /api/me/notifications; owner, 20 October
// 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in reminder)").

final unreadProvider = FutureProvider.autoDispose<int?>((ref) async {
  try {
    final json = await ref.read(peopleClientProvider).get('/api/me/notifications/unread-count');
    final n = json is Map ? json['unread'] : null;
    return n is num && n >= 0 ? n.toInt() : null;
  } on Object {
    return null;
  }
});

typedef InboxItem = ({String id, String kind, String title, String body, String link, bool read, DateTime? at});

final inboxProvider = FutureProvider.autoDispose<List<InboxItem>>((ref) async {
  final json = await ref.read(peopleClientProvider).get('/api/me/notifications?page=1');
  final items = json is Map && json['items'] is List ? json['items'] as List : const [];
  return [
    for (final i in items)
      if (i is Map)
        (
          id: '${i['id']}',
          kind: '${i['kind'] ?? ''}',
          title: '${i['title'] ?? ''}',
          body: '${i['body'] ?? ''}',
          link: '${i['link'] ?? ''}',
          read: i['readAt'] != null,
          at: DateTime.tryParse('${i['createdAt']}'),
        ),
  ];
});

/// The inbox in the design's sheet: the newest first, the unread ones marked; Mark all as read. Each one opens its
/// screen, marked read (owner, 8 November 2026: "opened notifications should be marked read"); one the app has no
/// screen for (a payslip, a raise) is marked read where it is, as the website does.
Future<void> showNotifications(BuildContext context) => showDesignSheet<void>(
  context,
  eyebrow: ShellWords.account,
  title: ShellWords.notifications,
  icon: CupertinoIcons.bell,
  builder: (context) => const _Inbox(),
);

class _Inbox extends ConsumerWidget {
  const _Inbox();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final inbox = ref.watch(inboxProvider);
    return inbox.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, _) => const Notice(text: ShellWords.notificationsFailed, ok: false),
      data: (items) {
        if (items.isEmpty) return Text(ShellWords.noNotifications, style: text.bodyMedium?.copyWith(color: p.muted));
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final i in items)
              InkWell(
                onTap: () => _open(context, i),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: p.line)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 7, right: 10),
                        child: Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: i.read ? Colors.transparent : p.ink),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(i.title, style: text.bodyLarge?.copyWith(fontWeight: i.read ? null : FontWeight.w600)),
                            if (i.body.isNotEmpty) Text(i.body, style: text.bodySmall),
                          ],
                        ),
                      ),
                      if (placeOf(i.link, i.kind) != null)
                        Padding(
                          padding: const EdgeInsets.only(left: 8, top: 2),
                          child: Icon(CupertinoIcons.chevron_right, size: 16, color: p.muted),
                        ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () async {
                try {
                  await ref.read(peopleClientProvider).post('/api/me/notifications/read-all');
                } on Object {
                  return;
                }
                ref
                  ..invalidate(inboxProvider)
                  ..invalidate(unreadProvider);
              },
              child: const Text(ShellWords.markAllRead),
            ),
          ],
        );
      },
    );
  }
}

/// A notification pressed: with a screen, the sheet closes and it opens there, marked read; without one, marked read
/// in the list.
void _open(BuildContext context, InboxItem i) {
  if (placeOf(i.link, i.kind) == null) {
    if (!i.read) unawaited(markNotificationRead(ProviderScope.containerOf(context, listen: false), i.id));
    return;
  }
  final sheet = Navigator.of(context);
  // the app's navigator and router, read before the sheet closes
  final app = Navigator.of(context, rootNavigator: true).context;
  sheet.pop();
  openNotification(app, id: i.read ? '' : i.id, link: i.link, kind: i.kind);
}

/// The header's bell: a round button with the unread count in its black badge (none at 0, 99+ above 99).
class Bell extends ConsumerWidget {
  const Bell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final n = ref.watch(unreadProvider).value ?? 0;
    return Tooltip(
      message: n > 0 ? ShellWords.unread(n) : ShellWords.notifications,
      child: Semantics(
        button: true,
        label: n > 0 ? ShellWords.unread(n) : ShellWords.notifications,
        excludeSemantics: true,
        child: InkResponse(
          onTap: () async {
            await showNotifications(context);
            ref.invalidate(unreadProvider);
          },
          radius: 24,
          child: SizedBox.square(
            dimension: 44,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(CupertinoIcons.bell, size: 22, color: p.ink),
                if (n > 0)
                  Positioned(
                    top: 0,
                    right: 0,
                    child: Container(
                      constraints: const BoxConstraints(minWidth: 22),
                      height: 22,
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: p.primary,
                        borderRadius: BorderRadius.circular(Tokens.radiusPill),
                        border: Border.all(color: p.canvas, width: 2),
                      ),
                      child: Text(n > 99 ? '99+' : '$n', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: p.onPrimary, height: 1)),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
