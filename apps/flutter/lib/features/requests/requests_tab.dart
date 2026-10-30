import 'dart:math' as math;

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/leave.dart';
import '../../models/requests.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import '../dashboard/dashboard_screen.dart' show DashboardWords;
import 'history.dart';
import 'kinds/claim.dart';
import 'kinds/compensatory.dart';
import 'kinds/correction.dart';
import 'kinds/home.dart';
import 'kinds/leave.dart';
import 'kinds/od.dart';
import 'kinds/permission.dart';
import 'kinds/resignation.dart';
import 'kinds/wfh.dart';
import 'request_page.dart';
import 'request_text.dart';
import 'requests_data.dart';
import 'requests_words.dart';

// The Requests tab, the phone design's "My Requests" (Figma "Mobile Flutter App", 30 October 2026, frames 11:354 light
// and 11:2812 dark), with what the website's My Requests decided the same day (apps/web my-requests): the page's head
// with Create request (the New leave sheet); the annual leave of the year with its ring and bar; the requests asked this
// year; this month's permission hours; Recent requests, every kind in one list with All / Approved / Waiting, each
// opening its page; the other leave types' balances; and Start another request, a card for each request People lets them
// start now, each opening its sheet. The design's "View leave policy" has no page in People, and its "Full" and "Open"
// have no figure behind them: left out, and the days left or used shown instead.

/// The kinds whose lists Recent requests reads, in the website's order.
const _listed = [
  RequestKind.leave,
  RequestKind.permission,
  RequestKind.correction,
  RequestKind.wfh,
  RequestKind.od,
  RequestKind.compensatory,
  RequestKind.home,
  RequestKind.claim,
  RequestKind.resignation,
];

/// How many rows Recent requests shows before "Show all".
const _historyLimit = 6;

class RequestsTab extends ConsumerStatefulWidget {
  const RequestsTab({super.key});

  @override
  ConsumerState<RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends ConsumerState<RequestsTab> {
  final _startKey = GlobalKey();

  Future<void> _refresh() async {
    requestsChanged(ref);
    ref.invalidate(leaveTypesProvider);
    await Future.wait([for (final k in _listed) ref.read(myRequestsProvider(k).future).then<void>((_) {}, onError: (_) {})]);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    const head = PageHead(eyebrow: RequestsWords.eyebrow, title: RequestsWords.title, intro: RequestsWords.intro);
    if (me == null || me.employeeId == null || me.hold) {
      return ListView(
        padding: tabPagePadding(context),
        children: [
          head,
          const SizedBox(height: 20),
          Notice(text: me?.hold == true ? DashboardWords.hold : RequestsWords.noProfile, ok: false),
        ],
      );
    }
    final year = DateTime.now().year;
    final profile = ref.watch(ownProfileProvider).value;
    // kept read while the tab shows, so each sheet says at once who decides (the CEO for a C-level person)
    ref.watch(confidentialProvider);
    final employment = profile?.raw['employment'];
    final employmentType = employment is Map ? employment['employmentType'] as String? : null;
    final leaveOffered = employment is Map && underLabourLaw(employmentType) && !isUnavailable(ref.watch(myRequestsProvider(RequestKind.leave)).error);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: tabPagePadding(context),
        children: [
          head,
          const SizedBox(height: 24),
          _CreateButton(
            onPressed: () {
              if (leaveOffered) {
                showLeaveSheet(context);
              } else if (_startKey.currentContext != null) {
                Scrollable.ensureVisible(_startKey.currentContext!, duration: const Duration(milliseconds: 350), curve: Curves.easeOut);
              }
            },
          ),
          const SizedBox(height: 24),
          if (employment is Map && underLabourLaw(employmentType)) ...[_AnnualCard(year: year), const SizedBox(height: 12)],
          _YearTile(year: year),
          if (employment is Map && underLabourLaw(employmentType)) const _PermissionTile(),
          const SizedBox(height: 12),
          const _History(),
          _OtherLeave(year: year),
          const SizedBox(height: 34),
          _StartAnother(key: _startKey, hasEmployment: employment is Map, employmentType: employmentType),
        ],
      ),
    );
  }
}

/// The page's black button: "+ Create request".
class _CreateButton extends StatelessWidget {
  const _CreateButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        boxShadow: p.shadow,
      ),
      child: FilledButton.icon(
        onPressed: onPressed,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget)),
        icon: const Icon(CupertinoIcons.add, size: 18),
        label: Text(RequestsWords.createRequest, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: p.onPrimary)),
      ),
    );
  }
}

// ---------- the annual leave ----------

class _AnnualCard extends ConsumerWidget {
  const _AnnualCard({required this.year});

  final int year;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final balances = ref.watch(balancesProvider(year));
    final b = balances.value;
    if (b == null) {
      return SurfaceCard(
        padding: const EdgeInsets.all(22),
        child: balances.hasError
            ? Text(RequestsWords.balanceNotLoaded, style: text.bodyMedium?.copyWith(color: p.muted))
            : const SizedBox(height: 120, child: Center(child: CircularProgressIndicator())),
      );
    }
    final a = b.annual;
    final share = annualShareLeft(a);
    final notYet = a.usableFrom != null && a.usableFrom!.compareTo(todayIso()) > 0;
    final figures = annualFigures(a);
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text(RequestsWords.annualOf(b.year), style: text.bodySmall)),
              if (notYet) Pill(RequestsWords.usableFromOf(dmy(a.usableFrom!))) else const Pill(RequestsWords.available, strong: true),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Text(daysFigure(a.available), style: text.displayMedium),
              const SizedBox(width: 12),
              Text(RequestsWords.daysAvailable(a.available), style: text.bodySmall?.copyWith(height: 1.25)),
              const Spacer(),
              _Ring(share: share, label: RequestsWords.ringLabel(percentText(share), b.year)),
            ],
          ),
          const SizedBox(height: 20),
          ClipRRect(
            borderRadius: BorderRadius.circular(Tokens.radiusPill),
            child: SizedBox(
              height: 7,
              child: Stack(
                children: [
                  Container(color: p.track),
                  FractionallySizedBox(
                    widthFactor: share,
                    child: Container(
                      decoration: BoxDecoration(color: p.ink, borderRadius: BorderRadius.circular(Tokens.radiusPill)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 15),
          LayoutBuilder(
            builder: (context, c) => Wrap(
              runSpacing: 8,
              children: [
                for (final (label, value) in figures)
                  SizedBox(
                    width: c.maxWidth / 2,
                    child: MergeSemantics(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(label, style: text.bodySmall),
                          const SizedBox(height: 4),
                          Text(value, style: text.labelMedium),
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

/// The share of the annual leave still there: a ring of 88 with "90%" and "remaining" in it.
class _Ring extends StatelessWidget {
  const _Ring({required this.share, required this.label});

  final double share;
  final String label;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: SizedBox.square(
        dimension: 88,
        child: CustomPaint(
          painter: _RingPainter(share: share, track: p.track, fill: p.ink),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(percentText(share), style: text.labelMedium?.copyWith(height: 1.4)),
                Text(RequestsWords.remaining, style: text.bodySmall?.copyWith(height: 1.1)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.share, required this.track, required this.fill});

  final double share;
  final Color track;
  final Color fill;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 7.0;
    final rect = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    canvas.drawArc(rect, 0, math.pi * 2, false, Paint()
      ..color = track
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke);
    if (share > 0) {
      canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * share, false, Paint()
        ..color = fill
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = stroke);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.share != share || old.track != track || old.fill != fill;
}

// ---------- the figures ----------

/// The design's tall figure: its icon, what it counts, the figure large and a note at the foot.
class _FigureTile extends StatelessWidget {
  const _FigureTile({required this.icon, required this.label, required this.value, required this.note, this.spoken});

  final IconData icon;
  final String label;
  final String value;
  final String note;
  final String? spoken;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconTile(icon),
            const SizedBox(height: 28),
            Text(label, style: text.bodySmall),
            const SizedBox(height: 5),
            Text(value, style: text.headlineLarge?.copyWith(letterSpacing: -1.87, height: 1.5), semanticsLabel: spoken),
            const SizedBox(height: 2),
            Text(note, style: text.bodySmall),
          ],
        ),
      ),
    );
  }
}

/// All the requests of every kind (what Recent requests lists), and the kinds that couldn't be read.
({List<PeopleRequest> all, List<String> failed, bool loading}) _everything(WidgetRef ref) {
  final all = <PeopleRequest>[];
  final failed = <String>[];
  var loading = false;
  for (final k in _listed) {
    final a = ref.watch(myRequestsProvider(k));
    if (a.hasValue) all.addAll(a.value!);
    if (a.isLoading && !a.hasValue) loading = true;
    if (a.hasError && !isUnavailable(a.error)) failed.add(RequestsWords.kindNames[k.name] ?? k.name);
  }
  return (all: all, failed: failed, loading: loading);
}

class _YearTile extends ConsumerWidget {
  const _YearTile({required this.year});

  final int year;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final e = _everything(ref);
    final summary = yearSummary(historyRows(e.all), year);
    return _FigureTile(
      icon: CupertinoIcons.doc_text,
      label: RequestsWords.requestsThisYear,
      value: e.loading ? '—' : twoDigits(summary.count),
      spoken: e.loading ? null : '${summary.count}',
      note: e.loading ? '' : summary.note,
    );
  }
}

class _PermissionTile extends ConsumerWidget {
  const _PermissionTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final month = isoDayOf(DateTime.now()).substring(0, 7);
    final m = ref.watch(permissionMonthProvider(month)).value;
    if (m == null) return const SizedBox.shrink();
    final f = permissionFigure(m);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: _FigureTile(icon: CupertinoIcons.clock, label: f.off ? RequestsWords.permission : RequestsWords.permissionLeft, value: f.value, note: f.note),
    );
  }
}

// ---------- recent requests ----------

class _History extends ConsumerStatefulWidget {
  const _History();

  @override
  ConsumerState<_History> createState() => _HistoryState();
}

class _HistoryState extends ConsumerState<_History> {
  HistoryFilter _show = HistoryFilter.all;
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final e = _everything(ref);
    final rows = historyRows(e.all);
    final matching = filterHistory(rows, _show);
    final shown = _all ? matching : matching.take(_historyLimit).toList();
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const CardHead(eyebrow: RequestsWords.history, title: RequestsWords.recentRequests),
          const SizedBox(height: 20),
          // never wider than the card, at any text size
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: SegmentedTabs<HistoryFilter>(
              values: HistoryFilter.values,
              labelOf: (f) => switch (f) {
                HistoryFilter.all => RequestsWords.all,
                HistoryFilter.approved => RequestsWords.approved,
                HistoryFilter.waiting => RequestsWords.waiting,
              },
              selected: _show,
              onChanged: (f) => setState(() => _show = f),
            ),
          ),
          if (e.failed.isNotEmpty) ...[const SizedBox(height: 14), Text(RequestsWords.failedOf(e.failed), style: text.bodySmall)],
          const SizedBox(height: 20),
          if (e.loading && rows.isEmpty)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (shown.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 28),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(13), border: Border.all(color: p.line)),
              child: Text(emptyHistoryText(rows.isEmpty ? HistoryFilter.all : _show), textAlign: TextAlign.center, style: text.bodySmall),
            )
          else
            Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(13), border: Border.all(color: p.line)),
              child: Material(
                type: MaterialType.transparency,
                child: Column(
                  children: [
                    for (final (i, r) in shown.indexed) ...[
                      if (i > 0) Divider(height: 1, color: p.line),
                      _HistoryRowTile(row: r),
                    ],
                  ],
                ),
              ),
            ),
          if (matching.length > _historyLimit)
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: ArrowLink(_all ? RequestsWords.showFewer : RequestsWords.showAll(matching.length), onTap: () => setState(() => _all = !_all)),
              ),
            ),
        ],
      ),
    );
  }
}

class _HistoryRowTile extends StatelessWidget {
  const _HistoryRowTile({required this.row});

  final HistoryRow row;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final r = row.request;
    return Semantics(
      button: true,
      label: RequestsWords.rowLabel(row.title, row.when, row.status),
      excludeSemantics: true,
      child: InkWell(
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: r.kind, id: r.id, initial: r))),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: p.raised, borderRadius: BorderRadius.circular(10), border: Border.all(color: p.line)),
                child: Icon(kindIcons[r.kind], size: 16, color: p.ink),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(row.title, style: text.labelMedium?.copyWith(height: 1.5)),
                    if (row.when.isNotEmpty) Text(row.when, style: text.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        StatusBadge(label: row.status, state: row.state, small: true),
                        Text(row.sent, style: text.bodySmall?.copyWith(fontSize: 12)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Icon(CupertinoIcons.arrow_right, size: 16, color: p.ink),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------- other leave ----------

class _OtherLeave extends ConsumerWidget {
  const _OtherLeave({required this.year});

  final int year;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final b = ref.watch(balancesProvider(year)).value;
    if (b == null) return const SizedBox.shrink();
    final types = ref.watch(leaveTypesProvider).value;
    final others = otherLeaveTypes(b, types);
    if (others.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 34),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _Head(eyebrow: RequestsWords.balances, title: RequestsWords.otherLeave),
          const SizedBox(height: 16),
          for (final t in others) ...[
            Builder(
              builder: (context) {
                final f = otherLeaveFigure(t, types?.where((x) => x.id == t.typeId).firstOrNull);
                return MergeSemantics(
                  child: Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: p.line)),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(t.nameEn, style: text.labelMedium?.copyWith(height: 1.5)),
                              if (t.nameAr != null) ...[const SizedBox(height: 5), Text(t.nameAr!, textDirection: TextDirection.rtl, style: text.bodySmall)],
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(f.value, style: text.titleMedium?.copyWith(height: 1.5)),
                            const SizedBox(height: 5),
                            Text(f.note, style: text.bodySmall),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

/// A section's head on the page: the small capitals over a title of 23 (the design's "Other leave").
class _Head extends StatelessWidget {
  const _Head({required this.eyebrow, required this.title, this.intro});

  final String eyebrow;
  final String title;
  final String? intro;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Eyebrow(eyebrow),
        const SizedBox(height: 5),
        Text(title, style: text.titleLarge),
        if (intro != null) ...[const SizedBox(height: 6), Text(intro!, style: text.bodySmall)],
      ],
    );
  }
}

// ---------- start another request ----------

class _StartAnother extends ConsumerWidget {
  const _StartAnother({super.key, required this.hasEmployment, required this.employmentType});

  final bool hasEmployment;
  final String? employmentType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    bool listed(RequestKind k) => !isUnavailable(ref.watch(myRequestsProvider(k)).error);
    final month = isoDayOf(DateTime.now()).substring(0, 7);
    final permissionMonth = underLabourLaw(employmentType) ? ref.watch(permissionMonthProvider(month)).value : null;
    final wfh = ref.watch(wfhAllowanceProvider).value;
    final od = ref.watch(odFormProvider).value;
    final compensatory = ref.watch(compensatoryFormProvider).value;
    final homes = ref.watch(myRequestsProvider(RequestKind.home)).value;
    final resignation = ref.watch(myResignationProvider).value;
    // each kind only when People lets them start one now, as the website's My Requests offers it
    final cards = <(String, Future<void> Function(BuildContext))>[
      if (listed(RequestKind.permission) && hasEmployment && permissionMonth != null && permissionMonth.hoursPerMonth > 0) ('permission', showPermissionSheet),
      if (listed(RequestKind.correction) && hasEmployment) ('correction', showCorrectionSheet),
      if (listed(RequestKind.wfh) && wfh != null && wfh.asks) ('wfh', showWfhSheet),
      if (listed(RequestKind.od) && od != null && od.refusal == null) ('od', showOdSheet),
      if (listed(RequestKind.compensatory) && compensatory != null && compensatory.asks) ('compensatory', showCompensatorySheet),
      if (homes != null && asksHome(homes.whereType<HomeLocationRequest>().toList())) ('home', showHomeSheet),
      if (listed(RequestKind.claim)) ('claim', showClaimSheet),
      if (resignation != null && resignation.form.offered) ('resignation', showResignationSheet),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Head(eyebrow: RequestsWords.selfService, title: RequestsWords.startAnother, intro: RequestsWords.startIntro),
        const SizedBox(height: 16),
        for (final (key, show) in cards) ...[
          _StartCard(kind: RequestKind.values.byName(key), words: RequestsWords.startCards[key]!, onTap: () => show(context)),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _StartCard extends StatelessWidget {
  const _StartCard({required this.kind, required this.words, required this.onTap});

  final RequestKind kind;
  final (String, String, String) words;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final (title, line, action) = words;
    return Semantics(
      button: true,
      label: '$title. $line $action.',
      excludeSemantics: true,
      child: Material(
        color: p.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15), side: BorderSide(color: p.line)),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(15),
          child: Padding(
            padding: const EdgeInsets.all(17),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IconTile(kindIcons[kind]!),
                const SizedBox(height: 16),
                Text(title, style: text.labelMedium?.copyWith(height: 1.5)),
                const SizedBox(height: 7),
                Text(line, style: text.bodySmall),
                const SizedBox(height: 26),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(child: Text(action, style: text.labelMedium?.copyWith(height: 1.5))),
                    const SizedBox(width: 6),
                    Icon(CupertinoIcons.arrow_right, size: 15, color: p.ink),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
