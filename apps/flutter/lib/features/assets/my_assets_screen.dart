import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../format.dart';
import '../../models/custody.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../profile/account_screens.dart';
import '../profile/profile_parts.dart';
import 'assets_data.dart';
import 'assets_words.dart';

// My Assets (owner, 31 October 2026: "show the employee assets, the ones he received from the company"; "every employee
// sees his assets"): the company's assets the person holds now and their custody records, from GET /api/me/custody, as
// the website's My Custody shows them. Read only and never a value: handovers and returns are the asset team's. Each
// item says what it is, its code, its record, since when, its return date (a shoot's, overdue in red) or long term, its
// condition when it went out and what went with it. A signed form opens on the People website for now.

class MyAssetsScreen extends ConsumerWidget {
  const MyAssetsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final custody = ref.watch(myCustodyProvider);
    return AccountPage(
      eyebrow: AssetsWords.eyebrow,
      title: AssetsWords.title,
      intro: AssetsWords.intro,
      onRefresh: () async {
        ref.invalidate(myCustodyProvider);
        await ref.read(myCustodyProvider.future).catchError((_) => const MyCustody());
      },
      children: switch (custody) {
        AsyncValue(value: final MyCustody c) => [
          if (c.overdue > 0) Notice(text: AssetsWords.overdue(c.overdue), ok: false),
          _HoldCard(items: c.current),
          _RecordsCard(records: c.records),
        ],
        AsyncError(:final error) => [LoadFailed(error: error, what: AssetsWords.notLoaded, onRetry: () => ref.invalidate(myCustodyProvider))],
        _ => [const CardLoading()],
      },
    );
  }
}

/// An asset's icon: by its type where one fits, else by its group.
IconData assetIconOf(HeldAsset a) => switch (a.type) {
  'LAP' || 'WKS' => CupertinoIcons.device_laptop,
  'PHN' || 'TAB' => CupertinoIcons.device_phone_portrait,
  'AUD' => CupertinoIcons.mic,
  'PRN' => CupertinoIcons.printer,
  'VEH' => CupertinoIcons.car,
  'LGT' => CupertinoIcons.lightbulb,
  _ => switch (a.group) {
    'kit' => CupertinoIcons.camera,
    'studio' => CupertinoIcons.lightbulb,
    'it' => CupertinoIcons.device_laptop,
    'office' => CupertinoIcons.briefcase,
    _ => CupertinoIcons.cube_box,
  },
};

// ---------- what they hold ----------

class _HoldCard extends StatelessWidget {
  const _HoldCard({required this.items});

  final List<HeldAsset> items;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ProfileCardHead(
            eyebrow: AssetsWords.custody,
            title: AssetsWords.whatYouHold,
            trailing: items.isEmpty ? null : Pill(AssetsWords.countOf(items.length), strong: true),
          ),
          const SizedBox(height: 17),
          if (items.isEmpty)
            Text(AssetsWords.holdNothing, style: text.bodyLarge?.copyWith(color: context.palette.muted))
          else
            for (final a in items) _HeldRow(asset: a),
        ],
      ),
    );
  }
}

class _HeldRow extends StatelessWidget {
  const _HeldRow({required this.asset});

  final HeldAsset asset;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final a = asset;
    final since = a.since;
    final lines = [
      ?a.makeAndModel,
      if (a.serial != null) AssetsWords.serial(a.serial!),
      if (a.conditionLabel != null) AssetsWords.condition(a.conditionLabel!),
      if (a.withIt != null) AssetsWords.withIt(a.withIt!),
      if (since != null) AssetsWords.since(shortDateOf(isoDayOf(since)), a.custodyCode) else a.custodyCode,
    ];
    return MergeSemantics(
      child: Container(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: p.line))),
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Tile(icon: assetIconOf(a)),
            const SizedBox(width: 17),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(a.name, style: text.bodyLarge),
                  const SizedBox(height: 3),
                  Text([a.code, a.typeLabel].join(' · '), style: text.labelMedium?.copyWith(color: p.muted)),
                  const SizedBox(height: 8),
                  for (final line in lines) ...[Text(line, style: text.bodySmall?.copyWith(height: 1.35)), const SizedBox(height: 3)],
                  const SizedBox(height: 6),
                  _Due(
                    text: dueTextOf(kind: a.kind, dueDate: a.dueDate, overdue: a.overdue, daysOverdue: a.daysOverdue),
                    overdue: a.overdue,
                    longTerm: a.kind != 'shoot' || a.dueDate == null,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------- their records ----------

class _RecordsCard extends StatelessWidget {
  const _RecordsCard({required this.records});

  final List<CustodyRecord> records;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final files = records.any((r) => r.files.isNotEmpty);
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ProfileCardHead(eyebrow: AssetsWords.history, title: AssetsWords.records),
          const SizedBox(height: 17),
          if (records.isEmpty)
            Text(AssetsWords.noRecords, style: text.bodyLarge?.copyWith(color: context.palette.muted))
          else ...[
            for (final r in records) _RecordRow(record: r),
            if (files) ...[const SizedBox(height: 8), Text(AssetsWords.openOnWebsite, style: text.bodySmall)],
          ],
        ],
      ),
    );
  }
}

class _RecordRow extends StatelessWidget {
  const _RecordRow({required this.record});

  final CustodyRecord record;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final r = record;
    final outAt = r.outAt;
    final line = [
      r.kindLabel,
      ?r.purpose,
      if (outAt != null) AssetsWords.outOn(shortDateOf(isoDayOf(outAt))),
      '${AssetsWords.countOf(r.items)}, ${outTextOf(r.items, r.out).toLowerCase()}',
    ].join(' · ');
    return MergeSemantics(
      child: Container(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: p.line))),
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _Tile(icon: CupertinoIcons.doc_text),
            const SizedBox(width: 17),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(r.code, style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                      Pill(r.statusLabel, strong: r.status != 'closed'),
                      if (!r.signed) const Pill(AssetsWords.notSigned),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(line, style: text.bodySmall?.copyWith(height: 1.35)),
                  const SizedBox(height: 6),
                  _Due(
                    text: dueTextOf(kind: r.kind, status: r.status, dueDate: r.dueDate, overdue: r.overdue, daysOverdue: r.daysOverdue),
                    overdue: r.overdue,
                    longTerm: r.kind != 'shoot' || r.dueDate == null,
                  ),
                  for (final f in r.files) ...[
                    const SizedBox(height: 6),
                    Text(AssetsWords.signedForm(f.fileName, sizeTextOf(f.sizeBytes)), style: text.bodySmall?.copyWith(color: p.ink)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------- the pieces ----------

/// The row's icon in its small tile (as the Profile's records: 36, 10 corners).
class _Tile extends StatelessWidget {
  const _Tile({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: p.raised,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: p.line),
      ),
      child: Icon(icon, size: 18, color: p.ink),
    );
  }
}

/// The return date: in red with a warning once past it, quiet for a long-term assignment.
class _Due extends StatelessWidget {
  const _Due({required this.text, required this.overdue, required this.longTerm});

  final String text;
  final bool overdue;
  final bool longTerm;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final style = Theme.of(context).textTheme.bodySmall;
    if (!overdue) return Text(text, style: style?.copyWith(color: longTerm ? p.muted : p.ink));
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(CupertinoIcons.exclamationmark_circle, size: 15, color: p.danger),
        const SizedBox(width: 6),
        Flexible(child: Text(text, style: style?.copyWith(color: p.danger, fontWeight: FontWeight.w600))),
      ],
    );
  }
}

/// The Profile's row to My Assets (in HR records): how many items are with them once read.
class AssetsRow extends ConsumerWidget {
  const AssetsRow({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final held = ref.watch(myCustodyProvider).value?.current.length;
    return RecordRow(
      icon: CupertinoIcons.cube_box,
      title: AssetsWords.companyAssets,
      subtitle: held == null ? AssetsWords.assetsLine : AssetsWords.withYou(held),
      onTap: onTap,
    );
  }
}
