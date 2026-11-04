import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../providers.dart';
import '../attendance/attendance_logic.dart' show momentText;

// Changes made by hand in the app (owner, 4 November 2026: "when HR corrects something manually, her manager has to be
// notified in a popup"; asked, "The HR person's manager", "Everything done for an employee", "Shows until marked seen"),
// as on the website (GET /api/me/manual-changes): each time the app opens while any change made by someone the person
// manages is unseen, what was done, its days and when. Seen marks them all read (on the bell too, POST
// /api/me/manual-changes/seen); Close leaves them for the next time.

abstract final class ManualChangeWords {
  static String title(int n) => '$n ${n == 1 ? 'change' : 'changes'} made by hand';
  static const line = 'By someone you manage, for an employee.';
  static String more(int n) => 'And $n more on your notifications.';
  static const seen = 'Seen';
  static const close = 'Close';
}

/// A change as the popup lists it.
class ManualChange {
  const ManualChange({required this.title, required this.body, required this.at});

  factory ManualChange.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return ManualChange(
      title: m['title'] is String ? m['title'] as String : '',
      body: m['body'] is String ? m['body'] as String : '',
      at: m['at'] is String ? DateTime.tryParse(m['at'] as String)?.toLocal() : null,
    );
  }

  final String title;
  final String body;
  final DateTime? at;
}

/// What GET /api/me/manual-changes says: the unseen changes listed (the newest), and how many in all.
class ManualChanges {
  const ManualChanges({required this.items, required this.total});

  factory ManualChanges.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    final list = m['items'];
    return ManualChanges(
      items: [if (list is List) for (final i in list) ManualChange.fromJson(i)],
      total: m['total'] is num ? (m['total'] as num).toInt() : 0,
    );
  }

  final List<ManualChange> items;
  final int total;
}

/// Shown when the app opens while changes are unseen; quiet when People can't be reached.
Future<void> showManualChanges(BuildContext context, WidgetRef ref) async {
  final ManualChanges v;
  try {
    v = ManualChanges.fromJson(await ref.read(peopleClientProvider).get('/api/me/manual-changes'));
  } catch (_) {
    return;
  }
  if (v.total <= 0 || !context.mounted) return;
  final more = v.total - v.items.length;
  final seen = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      icon: const Icon(Icons.edit_note_rounded, size: 36),
      title: Text(ManualChangeWords.title(v.total)),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            const Text(ManualChangeWords.line),
            const SizedBox(height: 12),
            for (final i in v.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(i.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text([i.body, if (i.at != null) momentText(i.at!)].join(' · ')),
                  ],
                ),
              ),
            if (more > 0) Text(ManualChangeWords.more(more)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text(ManualChangeWords.close)),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text(ManualChangeWords.seen)),
      ],
    ),
  );
  if (seen != true || !context.mounted) return;
  try {
    await ref.read(peopleClientProvider).post('/api/me/manual-changes/seen');
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
  }
}
