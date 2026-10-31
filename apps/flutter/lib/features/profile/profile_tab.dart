import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/employee_details.dart';
import '../../models/kpi.dart';
import '../../models/profile.dart';
import '../../providers.dart';
import '../../shell/app_shell.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../assets/assets_data.dart';
import '../assets/my_assets_screen.dart';
import '../dashboard/dashboard_data.dart';
import '../review/review_screen.dart' show openReview;
import 'change_request_sheet.dart';
import 'photo_data.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// The Profile tab (the phone design, Figma "Mobile Flutter App", 30 October 2026): who they are on the dark card (the
// initials, their code, name, job and how complete the profile is), four tiles (manager, work location, joined,
// employment), the Personal · Contact · Employment · KPIs switch and its card (the KPIs in place of the design's
// Payroll: owner, 31 October 2026, "replace payslips with the KPI's"), their HR records with the company's assets they
// hold (31 October 2026: "every employee sees his assets") and the account's settings. Only what People sends the employee: the file is HR's, so "Edit details" asks HR for a change (the website's
// Request a Change); no national ID, bank or salary (HR's, Finance's and the CEO's); the employee file's papers are HR's
// to see, so Documents says which ones HR still needs.

/// The four parts the switch shows.
enum ProfileSection { personal, contact, employment, kpis }

String _labelOf(ProfileSection s) => switch (s) {
  ProfileSection.personal => ProfileWords.personal,
  ProfileSection.contact => ProfileWords.contact,
  ProfileSection.employment => ProfileWords.employment,
  ProfileSection.kpis => ProfileWords.kpis,
};

class ProfileTab extends ConsumerStatefulWidget {
  const ProfileTab({super.key});

  @override
  ConsumerState<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends ConsumerState<ProfileTab> {
  var _section = ProfileSection.personal;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    if (me == null) return const SizedBox.shrink();
    if (me.employeeId == null) {
      return ListView(
        padding: tabPagePadding(context),
        children: const [
          PageHead(eyebrow: ProfileWords.pageEyebrow, title: ProfileWords.pageTitle),
          SizedBox(height: 16),
          Notice(text: ProfileWords.noProfile, ok: true),
          SizedBox(height: 12),
          _AccountCard(employee: false),
        ],
      );
    }
    final profile = ref.watch(ownProfileProvider);
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(ownProfileProvider)
          ..invalidate(myKpisProvider)
          ..invalidate(myCustodyProvider);
        await ref.read(ownProfileProvider.future).catchError((_) => null);
      },
      child: ListView(
        padding: tabPagePadding(context),
        children: switch (profile) {
          AsyncValue(value: final OwnProfile p) => _page(p),
          AsyncError(:final error) => [
            LoadFailed(error: error, what: ProfileWords.notLoaded, onRetry: () => ref.invalidate(ownProfileProvider)),
            const SizedBox(height: 12),
            const _AccountCard(employee: true),
          ],
          AsyncData() => [const Notice(text: ProfileWords.noProfile, ok: true), const SizedBox(height: 12), const _AccountCard(employee: false)],
          _ => [const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))],
        },
      ),
    );
  }

  List<Widget> _page(OwnProfile p) {
    final details = EmployeeDetails.of(p);
    return [
      _HeadCard(profile: p, job: details.job),
      const SizedBox(height: 12),
      _Tiles(job: details.job),
      const SizedBox(height: 12),
      _SectionSwitch(selected: _section, onChanged: (s) => setState(() => _section = s)),
      const SizedBox(height: 12),
      switch (_section) {
        ProfileSection.personal => _DetailsCard.personal(profile: p, details: details),
        ProfileSection.contact => _DetailsCard.contact(profile: p, details: details),
        ProfileSection.employment => _EmploymentCard(job: details.job),
        ProfileSection.kpis => const _KpisCard(),
      },
      const SizedBox(height: 12),
      _DocumentsCard(profile: p),
      const SizedBox(height: 12),
      const _AccountCard(employee: true),
    ];
  }
}

// ---------- the head ----------

class _HeadCard extends StatelessWidget {
  const _HeadCard({required this.profile, required this.job});

  final OwnProfile profile;
  final CurrentJob? job;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final muted = p.inverseMuted;
    final line = Color.lerp(p.inverse, p.onInverse, 0.16)!;
    final name = profile.fullNameEn.isEmpty ? (profile.displayName ?? '') : profile.fullNameEn;
    final code = profile.employeeCode;
    final where = [?job?.jobTitle ?? profile.jobTitle, ?job?.place ?? profile.department].join(' · ');
    final gaps = [for (final g in profile.missing) g.label];
    final percent = profile.percent.clamp(0, 100);
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: p.inverse,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: line),
        gradient: RadialGradient(center: const Alignment(0.9, -1), radius: 1.2, colors: [Color.lerp(p.inverse, p.onInverse, 0.1)!, p.inverse]),
        boxShadow: const [BoxShadow(color: Color(0x29000000), offset: Offset(0, 24), blurRadius: 60)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            button: true,
            label: ProfileWords.changePhoto,
            excludeSemantics: true,
            onTap: () => context.go('/profile/photo'),
            child: InkWell(
              onTap: () => context.go('/profile/photo'),
              customBorder: const CircleBorder(),
              child: SizedBox(
                width: 92,
                height: 92,
                child: Stack(
                  children: [
                    // their own photo since they send HR new ones (31 October 2026), else the initials
                    RoundPicture(
                      path: profile.photoId == null ? null : ownPhotoPath(profile.photoId!),
                      crop: profile.photoCrop,
                      name: name,
                      size: 86,
                      fill: p.onInverse,
                      ink: p.inverse,
                      fontSize: 24,
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: p.onInverse,
                          border: Border.all(color: p.inverse, width: 3),
                        ),
                        child: Icon(CupertinoIcons.person, size: 15, color: p.inverse),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text([ProfileWords.employeeProfile, ?code].join(' · ').toUpperCase(), style: text.labelSmall?.copyWith(color: muted)),
          const SizedBox(height: 7),
          // the first name in SemiBold, the rest regular (Figma 40/400 with a 600 override)
          Semantics(
            header: true,
            label: name,
            excludeSemantics: true,
            child: Text.rich(
              TextSpan(
                style: text.displaySmall?.copyWith(color: p.onInverse, fontWeight: FontWeight.w400),
                children: [
                  TextSpan(
                    text: name.split(' ').first,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (name.contains(' ')) TextSpan(text: name.substring(name.indexOf(' '))),
                ],
              ),
            ),
          ),
          if (where.isNotEmpty) ...[const SizedBox(height: 10), Text(where, style: text.bodyLarge?.copyWith(color: muted))],
          const SizedBox(height: 28),
          Container(height: 1, color: line),
          const SizedBox(height: 20),
          MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '$percent%',
                      style: text.headlineMedium?.copyWith(fontSize: 29, color: p.onInverse, letterSpacing: 0, height: 1.5),
                      semanticsLabel: ProfileWords.completeLabel(percent),
                    ),
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(ProfileWords.profileComplete, style: text.bodyMedium?.copyWith(color: muted)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(Tokens.radiusPill),
                  child: SizedBox(
                    height: 8,
                    child: Stack(
                      children: [
                        Container(color: Color.lerp(p.inverse, p.onInverse, 0.2)),
                        FractionallySizedBox(
                          widthFactor: percent / 100,
                          child: Container(color: p.onInverse),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(ProfileWords.missingOf(gaps), style: text.bodyMedium?.copyWith(color: muted)),
                // a change they asked for waits for HR (else the review comes first): they may confirm meanwhile
                if (profile.needsConfirming) ...[
                  const SizedBox(height: 6),
                  Text(ProfileWords.confirmNow, style: text.bodyMedium?.copyWith(color: p.onInverse)),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton(
                      onPressed: () => openReview(context),
                      style: OutlinedButton.styleFrom(foregroundColor: p.onInverse, side: BorderSide(color: muted)),
                      child: const Text(ProfileWords.reviewDetails),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------- the four tiles ----------

class _Tiles extends StatelessWidget {
  const _Tiles({required this.job});

  final CurrentJob? job;

  @override
  Widget build(BuildContext context) {
    final j = job;
    Widget tile(IconData icon, String label, String? value) => Expanded(
      child: _Tile(icon: icon, label: label, value: value ?? ProfileWords.none),
    );
    return Column(
      children: [
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              tile(CupertinoIcons.person_2, ProfileWords.manager, j?.manager),
              const SizedBox(width: 10),
              tile(CupertinoIcons.square_grid_2x2, ProfileWords.workLocation, EmployeeLabels.of(EmployeeLabels.workArrangement, j?.workArrangement)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              tile(CupertinoIcons.calendar, ProfileWords.joined, j?.joinDate == null ? null : shortDateOf(j!.joinDate!)),
              const SizedBox(width: 10),
              tile(CupertinoIcons.doc_text, ProfileWords.employment, EmployeeLabels.of(EmployeeLabels.employmentType, j?.employmentType)),
            ],
          ),
        ),
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return MergeSemantics(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: BorderRadius.circular(Tokens.radiusCard),
          border: Border.all(color: p.line),
          boxShadow: p.shadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconTile(icon),
            const SizedBox(height: 14),
            Text(label, style: text.bodySmall),
            const SizedBox(height: 4),
            Text(value, style: text.bodyLarge),
          ],
        ),
      ),
    );
  }
}

// ---------- the switch ----------

class _SectionSwitch extends StatelessWidget {
  const _SectionSwitch({required this.selected, required this.onChanged});

  final ProfileSection selected;
  final ValueChanged<ProfileSection> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    Widget item(ProfileSection s) {
      final on = s == selected;
      return Expanded(
        child: MergeSemantics(
          child: Semantics(
            button: true,
            selected: on,
            child: Material(
              type: MaterialType.transparency,
              child: InkWell(
                onTap: () => onChanged(s),
                borderRadius: BorderRadius.circular(10),
                child: Ink(
                  height: Tokens.tapTarget,
                  decoration: BoxDecoration(color: on ? p.primary : Colors.transparent, borderRadius: BorderRadius.circular(10)),
                  child: Center(
                    child: Text(_labelOf(s), style: text.labelMedium?.copyWith(color: on ? p.onPrimary : p.muted)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Semantics(
      container: true,
      label: ProfileWords.sections,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: p.raised,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: p.line),
        ),
        child: Column(
          children: [
            Row(children: [item(ProfileSection.personal), const SizedBox(width: 4), item(ProfileSection.contact)]),
            const SizedBox(height: 4),
            Row(children: [item(ProfileSection.employment), const SizedBox(width: 4), item(ProfileSection.kpis)]),
          ],
        ),
      ),
    );
  }
}

// ---------- personal and contact ----------

/// A value as the profile shows it: a date as 14 Feb 2024, a code in words.
String? shownValue(DetailField f, Object? v) {
  if (v == null) return null;
  final s = '$v';
  return switch (f.kind) {
    FieldKind.date => RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(s) ? shortDateOf(s.substring(0, 10)) : s,
    FieldKind.choice => f.choices[s] ?? s,
    _ => s,
  };
}

class _DetailsCard extends ConsumerWidget {
  const _DetailsCard.personal({required this.profile, required this.details})
    : eyebrow = ProfileWords.personalInformation,
      title = ProfileWords.personalDetails,
      intro = ProfileWords.personalIntro,
      groups = const [(null, DetailFields.personal), (ProfileWords.education, DetailFields.education)],
      workEmail = false;

  const _DetailsCard.contact({required this.profile, required this.details})
    : eyebrow = ProfileWords.contactInformation,
      title = ProfileWords.contactDetails,
      intro = ProfileWords.contactIntro,
      groups = const [(null, DetailFields.contact), (ProfileWords.emergencyContact, DetailFields.emergency)],
      workEmail = true;

  final OwnProfile profile;
  final EmployeeDetails details;
  final String eyebrow;
  final String title;
  final String intro;
  final List<(String?, List<DetailField>)> groups;
  final bool workEmail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final pending = details.pendingRequest;
    final decided = details.lastDecided;
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ProfileCardHead(eyebrow: eyebrow, title: title, intro: intro),
          const SizedBox(height: 24),
          if (pending != null)
            _PendingRequest(request: pending)
          else ...[
            QuietButton(
              ProfileWords.askToChange,
              expand: true,
              large: true,
              onPressed: () => askToChange(context, ref, employeeId: profile.id, details: details, groups: groups),
            ),
            if (decided != null && decided.requestedAt != null) ...[
              const SizedBox(height: 12),
              Text(
                ProfileWords.lastDecision(EmployeeLabels.of(EmployeeLabels.changeStatus, decided.status)!, shortDateOf(isoDayOf(decided.requestedAt!))),
                style: text.bodySmall,
              ),
              if (decided.decisionNote != null) Text('${ProfileWords.hrNote}: ${decided.decisionNote}', style: text.bodySmall),
            ],
          ],
          const SizedBox(height: 24),
          Container(height: 1, color: p.line),
          const SizedBox(height: 22),
          if (workEmail) ReadOnlyField(label: ProfileWords.workEmail, value: details.workEmail, note: ProfileWords.workEmailNote),
          for (final (heading, fields) in groups) ...[
            if (heading != null) ...[
              const SizedBox(height: 10),
              Semantics(header: true, child: Text(heading, style: text.titleMedium)),
              const SizedBox(height: 12),
            ],
            for (final f in fields) ReadOnlyField(label: f.label, value: shownValue(f, details.values[f.key]), arabic: f.arabic),
          ],
        ],
      ),
    );
  }
}

/// The request waiting for HR: what it asks, and Cancel request.
class _PendingRequest extends ConsumerStatefulWidget {
  const _PendingRequest({required this.request});

  final ChangeRequest request;

  @override
  ConsumerState<_PendingRequest> createState() => _PendingRequestState();
}

class _PendingRequestState extends ConsumerState<_PendingRequest> {
  var _busy = false;
  String? _error;

  Future<void> _cancel() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text(ProfileWords.cancelAsk),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(ProfileWords.keepIt)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(ProfileWords.cancelRequest)),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(peopleClientProvider).post('/api/change-requests/${Uri.encodeComponent(widget.request.id)}/cancel');
      messenger.showSnackBar(const SnackBar(content: Text(ProfileWords.cancelled)));
      ref.invalidate(ownProfileProvider);
    } on Object catch (e) {
      if (mounted) setState(() => _error = wordsOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final r = widget.request;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.raised,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: p.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(ProfileWords.waitingSince(r.requestedAt == null ? '' : shortDateOf(isoDayOf(r.requestedAt!))), style: text.bodyMedium),
          const SizedBox(height: 10),
          for (final c in r.changes)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('${c.label}: ${_changeValue(c.field, c.from)} → ${_changeValue(c.field, c.to)}', style: text.bodySmall),
            ),
          if (_error != null) ...[const SizedBox(height: 8), Text(_error!, style: text.bodySmall?.copyWith(color: p.danger))],
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: QuietButton(ProfileWords.cancelRequest, onPressed: _busy ? null : _cancel),
          ),
        ],
      ),
    );
  }

  String _changeValue(String field, Object? v) {
    final f = DetailFields.byKey[field];
    if (v == null || '$v'.isEmpty) return '—';
    if (v is bool) return v ? 'Yes' : 'No';
    return f == null ? '$v' : (shownValue(f, v) ?? '—');
  }
}

// ---------- employment ----------

class _EmploymentCard extends StatelessWidget {
  const _EmploymentCard({required this.job});

  final CurrentJob? job;

  static const _days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final j = job;
    String? arrangement;
    if (j != null) {
      arrangement = EmployeeLabels.of(EmployeeLabels.workArrangement, j.workArrangement);
    }
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ProfileCardHead(eyebrow: ProfileWords.employment, title: ProfileWords.yourJob, intro: ProfileWords.employmentIntro),
          const SizedBox(height: 24),
          Container(height: 1, color: p.line),
          const SizedBox(height: 22),
          if (j == null)
            Text(ProfileWords.noJob, style: Theme.of(context).textTheme.bodyLarge)
          else ...[
            ReadOnlyField(label: ProfileWords.jobTitle, value: j.jobTitle),
            ReadOnlyField(label: j.placeIsTeam ? ProfileWords.team : ProfileWords.department, value: j.place),
            ReadOnlyField(label: ProfileWords.grade, value: j.grade),
            ReadOnlyField(label: ProfileWords.manager, value: j.manager),
            ReadOnlyField(label: ProfileWords.status, value: EmployeeLabels.of(EmployeeLabels.status, j.status)),
            ReadOnlyField(label: ProfileWords.employmentType, value: EmployeeLabels.of(EmployeeLabels.employmentType, j.employmentType)),
            ReadOnlyField(label: ProfileWords.joined, value: j.joinDate == null ? null : shortDateOf(j.joinDate!)),
            if (j.probationEnd != null) ReadOnlyField(label: ProfileWords.probationEnds, value: shortDateOf(j.probationEnd!)),
            ReadOnlyField(
              label: ProfileWords.workArrangement,
              value: arrangement,
              note: j.workArrangement == 'hybrid' && j.officeDays.isNotEmpty
                  ? ProfileWords.officeDays(j.officeDays.where((d) => d >= 0 && d < 7).map((d) => _days[d]).join(', '))
                  : null,
            ),
            ReadOnlyField(label: ProfileWords.shift, value: j.shift),
            // no contract details on the employee's profile (owner, 31 October 2026: "show no contract details anywhere in
            // an employee profile")
          ],
        ],
      ),
    );
  }
}

// ---------- KPIs ----------

/// Their monthly scorecards (owner, 31 October 2026: "replace payslips with the KPI's"): the latest three, each with its
/// step and, once signed off, its final % and level; all of them on My performance.
class _KpisCard extends ConsumerWidget {
  const _KpisCard();

  static const _shown = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final cards = ref.watch(myKpisProvider);
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ProfileCardHead(eyebrow: ProfileWords.performance, title: ProfileWords.kpisTitle, intro: ProfileWords.kpisIntro),
          const SizedBox(height: 17),
          switch (cards) {
            AsyncValue(value: final List<KpiScorecard> list) when list.isEmpty => Text(ProfileWords.noKpis, style: text.bodyMedium),
            AsyncValue(value: final List<KpiScorecard> list) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final k in list.take(_shown))
                  RecordRow(
                    icon: CupertinoIcons.graph_square,
                    title: monthNameOf(k.month),
                    subtitle: k.levelLabel ?? k.statusLabel,
                    trailing: Padding(
                      padding: const EdgeInsets.only(left: 12),
                      child: k.finalPercent == null ? Pill(k.statusLabel) : Text('${oneDecimal(k.finalPercent!)}%', style: text.titleLarge),
                    ),
                  ),
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: ArrowLink(
                    list.length > _shown ? ProfileWords.allScorecards(list.length) : ProfileWords.openPerformance,
                    onTap: () => context.go('/profile/performance'),
                  ),
                ),
              ],
            ),
            AsyncError(:final error) => LoadFailed(error: error, onRetry: () => ref.invalidate(myKpisProvider)),
            _ => const SizedBox(height: 60, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
          },
        ],
      ),
    );
  }
}

// ---------- documents ----------

/// HR's records (owner, 31 October 2026, on the app's Documents: "hide employee contract", "and for the files allow the
/// employee to see the files with a red or green icon if submitted or missing"): each paper the employee file needs, a
/// green mark when HR has it on file, a red one when it's missing (its name only: never the scan); then the company's
/// assets with them.
class _DocumentsCard extends StatelessWidget {
  const _DocumentsCard({required this.profile});

  final OwnProfile profile;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final papers = profile.papers;
    final missing = profile.papersMissing;
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ProfileCardHead(eyebrow: ProfileWords.hrRecords, title: ProfileWords.documents),
          const SizedBox(height: 17),
          for (final paper in papers)
            RecordRow(
              icon: CupertinoIcons.doc,
              title: paper.label,
              subtitle: paper.onFile ? ProfileWords.onFile : ProfileWords.missingPaper,
              // the words beside it say it already
              trailing: ExcludeSemantics(
                child: Icon(
                  paper.onFile ? CupertinoIcons.checkmark_circle_fill : CupertinoIcons.xmark_circle_fill,
                  size: 24,
                  color: paper.onFile ? p.ok : p.danger,
                ),
              ),
            ),
          // an API from before the list: the missing ones, or all on file
          if (papers.isEmpty) ...[
            for (final paper in missing) RecordRow(icon: CupertinoIcons.doc, title: paper, subtitle: ProfileWords.neededByHr),
            if (missing.isEmpty) const RecordRow(icon: CupertinoIcons.folder, title: ProfileWords.employeeFile, subtitle: ProfileWords.fileComplete),
          ],
          // what the company handed them (owner, 31 October 2026: "every employee sees his assets")
          AssetsRow(onTap: () => context.go('/profile/assets')),
        ],
      ),
    );
  }
}

// ---------- the account ----------

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.employee});

  /// An employee's account: the photo and the interview hours too.
  final bool employee;

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ProfileCardHead(eyebrow: ProfileWords.account, title: ProfileWords.securityAndPreferences),
          const SizedBox(height: 17),
          if (employee)
            RecordRow(
              icon: CupertinoIcons.person,
              title: ProfileWords.changePhoto,
              subtitle: ProfileWords.photoLine,
              onTap: () => context.go('/profile/photo'),
            ),
          RecordRow(
            icon: CupertinoIcons.lock,
            title: ProfileWords.changePassword,
            subtitle: ProfileWords.passwordLine,
            onTap: () => context.go('/profile/password'),
          ),
          RecordRow(
            icon: CupertinoIcons.square_grid_2x2,
            title: ProfileWords.sessions,
            subtitle: ProfileWords.sessionsLine,
            onTap: () => context.go('/profile/sessions'),
          ),
          if (employee)
            RecordRow(
              icon: CupertinoIcons.clock,
              title: ProfileWords.interviewHours,
              subtitle: ProfileWords.interviewLine,
              onTap: () => context.go('/profile/interview-hours'),
            ),
        ],
      ),
    );
  }
}
