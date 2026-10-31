import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/photo_request.dart';
import '../../models/profile.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import '../requests/requests_data.dart' show PickedPhoto, photoSourceProvider, sendForm;
import '../requests/requests_words.dart' show RequestsWords;
import 'account_screens.dart';
import 'photo_data.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Profile Image (the phone design). People keeps the picture beside one's name as the personal photo in the employee
// file; the employee sends HR a new one (owner, 31 October 2026: "allow them to upload a new photo as a request and
// approved from the HR"): taken with the camera or chosen from the phone's photos (made a JPEG, as the requests' photos
// are), seen before it goes, with a note for HR, optional (POST /api/employees/:id/photo-requests). It becomes their
// picture once HR approves it; one waits at a time, and they may cancel it until HR decides. Their picture now and the
// one waiting are theirs to see (their own face); what HR decided last, with HR's note. Then the design's advice.

class ProfilePhotoScreen extends ConsumerWidget {
  const ProfilePhotoScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    final read = ref.watch(ownProfileProvider);
    final profile = read.value;
    final name = profile?.fullNameEn.isNotEmpty == true ? profile!.fullNameEn : (me?.name ?? me?.firstName ?? '');
    final requests = profile?.photoRequests ?? const <PhotoRequest>[];
    PhotoRequest? waiting;
    PhotoRequest? last;
    for (final r in requests) {
      if (r.pending) {
        waiting ??= r;
      } else {
        last ??= r;
      }
    }
    return AccountPage(
      eyebrow: AccountWords.profileEyebrow,
      title: AccountWords.photoTitle,
      intro: AccountWords.photoIntro,
      onRefresh: () async {
        ref.invalidate(ownProfileProvider);
        await ref.read(ownProfileProvider.future).catchError((_) => null);
      },
      children: [
        _NowCard(profile: profile, name: name),
        if (read.hasError && profile == null)
          LoadFailed(error: read.error!, what: ProfileWords.notLoaded, onRetry: () => ref.invalidate(ownProfileProvider))
        else if (profile != null)
          waiting != null ? _WaitingCard(request: waiting, name: name) : _SendCard(employeeId: profile.id, last: last),
        const _TipsCard(),
      ],
    );
  }
}

/// Their picture now: the personal photo in their employee file, round as HR cropped it, or their initials.
class _NowCard extends StatelessWidget {
  const _NowCard({required this.profile, required this.name});

  final OwnProfile? profile;
  final String name;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final id = profile?.photoId;
    return SurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RoundPicture(
            path: id == null ? null : ownPhotoPath(id),
            crop: profile?.photoCrop,
            name: name,
            size: 130,
            fill: p.primary,
            ink: p.onPrimary,
            fontSize: 38,
          ),
          const SizedBox(height: 30),
          Semantics(
            header: true,
            child: Text(AccountWords.photoNow, style: text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.88)),
          ),
          const SizedBox(height: 10),
          Text(id == null ? AccountWords.noPhotoYet : AccountWords.photoFromFile, style: text.bodySmall),
        ],
      ),
    );
  }
}

/// The photo waiting for HR, the note sent with it, and Cancel.
class _WaitingCard extends ConsumerStatefulWidget {
  const _WaitingCard({required this.request, required this.name});

  final PhotoRequest request;
  final String name;

  @override
  ConsumerState<_WaitingCard> createState() => _WaitingCardState();
}

class _WaitingCardState extends ConsumerState<_WaitingCard> {
  var _busy = false;
  String? _error;

  Future<void> _cancel() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text(AccountWords.cancelPhotoAsk),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(AccountWords.keepPhoto)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(AccountWords.cancelPhoto)),
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
      await ref.read(peopleClientProvider).post('/api/photo-requests/${Uri.encodeComponent(widget.request.id)}/cancel');
      messenger.showSnackBar(const SnackBar(content: Text(AccountWords.photoCancelled)));
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
    return SurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(AccountWords.photoWaiting),
          const SizedBox(height: 16),
          RoundPicture(
            path: sentPhotoPath(r.id),
            name: widget.name,
            label: AccountWords.sentPhoto,
            size: 110,
            fill: p.raised,
            ink: p.ink,
            fontSize: 32,
          ),
          const SizedBox(height: 16),
          if (r.requestedAt != null) Text(AccountWords.photoWaitingSince(shortDateOf(isoDayOf(r.requestedAt!.toLocal()))), style: text.bodyMedium),
          if (r.note != null) ...[const SizedBox(height: 8), Text('${AccountWords.yourNote}: ${r.note}', style: text.bodySmall)],
          if (_error != null) ...[const SizedBox(height: 12), Notice(text: _error!, ok: false)],
          const SizedBox(height: 16),
          QuietButton(AccountWords.cancelPhoto, onPressed: _busy ? null : _cancel),
        ],
      ),
    );
  }
}

/// A new photo to send: taken or chosen, seen before it goes, a note for HR; what HR decided on the last one above it.
class _SendCard extends ConsumerStatefulWidget {
  const _SendCard({required this.employeeId, required this.last});

  final String employeeId;
  final PhotoRequest? last;

  @override
  ConsumerState<_SendCard> createState() => _SendCardState();
}

class _SendCardState extends ConsumerState<_SendCard> {
  PickedPhoto? _photo;
  final _note = TextEditingController();
  var _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick({required bool camera}) async {
    setState(() => _error = null);
    try {
      final photo = await ref.read(photoSourceProvider).pick(camera: camera);
      if (photo != null && mounted) setState(() => _photo = photo);
    } on Exception {
      // the camera or the photos refused (no permission): said in words, the screen stays
      if (mounted) setState(() => _error = RequestsWords.photoFailed);
    }
  }

  Future<void> _send() async {
    final photo = _photo;
    if (photo == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    try {
      final note = _note.text.trim();
      await sendForm(ref, '/api/employees/${Uri.encodeComponent(widget.employeeId)}/photo-requests', {if (note.isNotEmpty) 'note': note}, [('file', photo)]);
      messenger.showSnackBar(const SnackBar(content: Text(AccountWords.photoSent)));
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
    final last = widget.last;
    final photo = _photo;
    return SurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(AccountWords.newPhoto, style: text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.88)),
          ),
          const SizedBox(height: 10),
          Text(AccountWords.newPhotoLine, style: text.bodySmall),
          if (last != null && last.requestedAt != null) ...[
            const SizedBox(height: 14),
            Text(AccountWords.photoOutcome(last.status, shortDateOf(isoDayOf(last.requestedAt!.toLocal()))), style: text.bodyMedium),
            if (last.decisionNote != null && last.status != 'cancelled')
              Text('${AccountWords.hrNote}: ${last.decisionNote}', style: text.bodySmall),
          ],
          const SizedBox(height: 18),
          if (photo == null) ...[
            FilledButton.icon(
              onPressed: _busy ? null : () => _pick(camera: true),
              icon: const Icon(CupertinoIcons.camera, size: 18),
              label: const Text(AccountWords.takePhoto),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _busy ? null : () => _pick(camera: false),
              icon: const Icon(CupertinoIcons.photo, size: 18),
              label: const Text(AccountWords.choosePhoto),
            ),
          ] else ...[
            Center(
              child: Semantics(
                image: true,
                label: AccountWords.chosenPhoto,
                child: ClipOval(
                  child: Image.memory(
                    photo.bytes,
                    width: 130,
                    height: 130,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => Container(width: 130, height: 130, color: p.raised, child: Icon(CupertinoIcons.photo, color: p.muted)),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(AccountWords.noteForHr, style: text.bodyMedium?.copyWith(color: p.muted)),
            const SizedBox(height: 8),
            TextField(controller: _note, minLines: 1, maxLines: 4, maxLength: 1000, enabled: !_busy),
            const SizedBox(height: 8),
            FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? AccountWords.sendingPhoto : AccountWords.sendPhoto)),
            const SizedBox(height: 10),
            QuietButton(AccountWords.chooseAnother, expand: true, onPressed: _busy ? null : () => setState(() => _photo = null)),
          ],
          if (_error != null) ...[const SizedBox(height: 14), Notice(text: _error!, ok: false)],
        ],
      ),
    );
  }
}

/// The design's advice for a good photo.
class _TipsCard extends StatelessWidget {
  const _TipsCard();

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(AccountWords.goodPhoto),
          for (final (i, tip) in AccountWords.photoTips.indexed) ...[
            const SizedBox(height: 20),
            MergeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 27,
                    height: 27,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: p.primary),
                    child: Text((i + 1).toString().padLeft(2, '0'), style: text.labelMedium?.copyWith(color: p.onPrimary)),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(tip, style: text.bodySmall),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: Tokens.gapSmall),
        ],
      ),
    );
  }
}
