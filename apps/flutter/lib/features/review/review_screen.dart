import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../models/employee_details.dart';
import '../../models/profile.dart';
import '../../models/review.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import '../profile/change_request_sheet.dart';
import '../profile/profile_parts.dart';
import 'review_words.dart';

// Review your details (owner, 31 October 2026: "make the data review obligatory upon the signin for employees"): the
// website's confirm page in the app (apps/web employees/[id]/confirm). The details HR keeps, in the website's parts
// (personal, contact, emergency contact, education: packages/shared CONFIRM_FIELDS), each changed since they last
// confirmed marked; the statement in English and Arabic, ticked to confirm (POST /api/employees/:id/confirm, as the
// website sends it); Ask for a change (the Profile's sheet). Shown by the review gate before anything else while it
// waits, with Sign out; and opened from the Profile or the Dashboard to confirm while a change waits for HR.

/// What the review says first: why it is asked for now.
String reviewReason(Confirmation? c) {
  if (c == null || c.confirmedAt == null) return ReviewWords.never;
  if (c.changedFields.isEmpty) return ReviewWords.again;
  return ReviewWords.changed(ConfirmFields.namesOf(c.changedFields));
}

/// The parts the change request's sheet asks for, as the Profile's (the work email is the company's).
const reviewChangeGroups = [
  (ReviewWords.personal, DetailFields.personal),
  (ReviewWords.contact, DetailFields.contact),
  (ReviewWords.emergency, DetailFields.emergency),
  (ReviewWords.education, DetailFields.education),
];

/// Opens the review over the app (from the Profile or the Dashboard), to close again.
Future<void> openReview(BuildContext context) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => const ReviewScreen(leavable: true)));

class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key, this.leavable = false});

  /// Opened to confirm by choice: Close instead of Sign out, and closed once confirmed.
  final bool leavable;

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  var _accepted = false;
  var _busy = false;
  String? _error;

  Future<void> _confirm(OwnProfile profile) async {
    if (!_accepted) {
      setState(() => _error = ReviewWords.mustAccept);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref.read(peopleClientProvider).post('/api/employees/${Uri.encodeComponent(profile.id)}/confirm', {
        'accept': true,
        'disclaimerVersion': ProfileDisclaimer.version,
      });
      messenger.showSnackBar(const SnackBar(content: Text(ReviewWords.confirmed)));
      // read again: the gate lifts once People says the details are confirmed
      ref.invalidate(ownProfileProvider);
      if (widget.leavable && mounted) navigator.pop();
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
    final profile = ref.watch(ownProfileProvider);
    final own = profile.value;
    return Scaffold(
      appBar: widget.leavable
          ? AppBar(leading: IconButton(tooltip: ReviewWords.close, icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()))
          : null,
      body: SafeArea(
        child: own == null
            ? (profile.hasError
                  ? Padding(
                      padding: Tokens.pagePadding,
                      child: LoadFailed(error: profile.error!, what: ReviewWords.notLoaded, onRetry: () => ref.invalidate(ownProfileProvider)),
                    )
                  : const Center(child: CircularProgressIndicator()))
            : ListView(
                padding: Tokens.pagePadding.copyWith(bottom: 32 + MediaQuery.paddingOf(context).bottom),
                children: [
                  if (!widget.leavable)
                    Row(
                      children: [
                        const BrandLine(),
                        const Spacer(),
                        TextButton(onPressed: () => ref.read(authProvider.notifier).signOut(), child: const Text(ReviewWords.signOut)),
                      ],
                    ),
                  const SizedBox(height: 20),
                  Semantics(
                    header: true,
                    child: PageHead(eyebrow: ReviewWords.eyebrow, title: ReviewWords.title, intro: reviewReason(own.confirmation)),
                  ),
                  const SizedBox(height: 10),
                  Text(ReviewWords.why, style: text.bodyMedium?.copyWith(color: p.muted)),
                  if (own.changeWaiting) ...[const SizedBox(height: 16), const Notice(text: ReviewWords.changeWaiting, ok: true)],
                  const SizedBox(height: 20),
                  for (final section in ConfirmSection.values) ...[
                    _SectionCard(section: section, profile: own),
                    const SizedBox(height: 12),
                  ],
                  SurfaceCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Semantics(header: true, child: Text(ReviewWords.statement, style: text.titleMedium)),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: p.raised,
                            borderRadius: BorderRadius.circular(11),
                            border: Border.all(color: p.line),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(ProfileDisclaimer.en, style: text.bodyMedium),
                              const SizedBox(height: 10),
                              Text(ProfileDisclaimer.ar, textDirection: TextDirection.rtl, style: text.bodyMedium),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        // its own surface, so its ink shows on the card
                        Material(
                          type: MaterialType.transparency,
                          child: CheckboxListTile(
                            value: _accepted,
                            onChanged: _busy ? null : (v) => setState(() => _accepted = v ?? false),
                            title: Text(ReviewWords.accept, style: text.bodyMedium),
                            controlAffinity: ListTileControlAffinity.leading,
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                        if (_error != null) ...[const SizedBox(height: 8), Notice(text: _error!, ok: false)],
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _busy ? null : () => _confirm(own), child: Text(_busy ? ReviewWords.confirming : ReviewWords.confirm)),
                        if (!own.changeWaiting) ...[
                          const SizedBox(height: 18),
                          Text(ReviewWords.askLine, style: text.bodySmall),
                          const SizedBox(height: 10),
                          QuietButton(
                            ReviewWords.askForChange,
                            expand: true,
                            large: true,
                            onPressed: _busy
                                ? null
                                : () => askToChange(context, ref, employeeId: own.id, details: EmployeeDetails.of(own), groups: reviewChangeGroups),
                          ),
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

/// One part of the details, each as kept, those changed since they last confirmed marked.
class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.section, required this.profile});

  final ConfirmSection section;
  final OwnProfile profile;

  @override
  Widget build(BuildContext context) {
    final changed = profile.confirmation?.changedFields.toSet() ?? const <String>{};
    return SurfaceCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(confirmSectionLabels[section]!, style: Theme.of(context).textTheme.titleMedium)),
          const SizedBox(height: 14),
          for (final f in ConfirmFields.of(section))
            ReadOnlyField(
              label: f.label,
              value: confirmValueOf(f, profile.raw),
              arabic: f.arabic,
              note: changed.contains(f.key) ? ReviewWords.changedSince : null,
            ),
        ],
      ),
    );
  }
}
