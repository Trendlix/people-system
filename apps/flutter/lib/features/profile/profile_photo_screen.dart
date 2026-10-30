import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../dashboard/dashboard_data.dart';
import 'account_screens.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Profile Image (the phone design). People keeps the picture beside one's name as the personal photo in the employee
// file, which only HR adds and crops (apps/api paperwork.controller.ts: uploads and the crop are HR's; the photo is shown
// to HR and the CEO, and the profile sends the employee no photo of their own). So this screen says how it is set,
// honestly, instead of offering an upload People would refuse: the initials, how to change it (give HR a new photo), and
// the design's advice for a good one.

class ProfilePhotoScreen extends ConsumerWidget {
  const ProfilePhotoScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;
    final profile = ref.watch(ownProfileProvider).value;
    final name = profile?.fullNameEn.isNotEmpty == true ? profile!.fullNameEn : (me?.name ?? me?.firstName ?? '');
    return AccountPage(
      eyebrow: AccountWords.profileEyebrow,
      title: AccountWords.photoTitle,
      intro: AccountWords.photoIntro,
      children: [
        SurfaceCard(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InitialsCircle(name: name, size: 130, fill: p.primary, ink: p.onPrimary, fontSize: 38),
              const SizedBox(height: 30),
              Semantics(
                header: true,
                child: Text(AccountWords.photoSetByHr, style: text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.88)),
              ),
              const SizedBox(height: 10),
              Text(AccountWords.photoHow, style: text.bodySmall),
            ],
          ),
        ),
        SurfaceCard(
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
        ),
      ],
    );
  }
}
