import 'package:flutter/material.dart';

import '../../shell/app_shell.dart';
import '../../theme/parts.dart';

export 'change_password_screen.dart';
export 'interview_hours_screen.dart';
export 'profile_photo_screen.dart';
export 'sessions_screen.dart';

/// The account's screens under Profile (the phone design: Change Password, Profile Image, Your Sessions, Your Interview
/// Hours), opened from the Profile's Security & preferences and from the More menu: the small capitals, the large
/// title and its line, then the cards, 12 apart.
class AccountPage extends StatelessWidget {
  const AccountPage({super.key, required this.eyebrow, required this.title, required this.intro, required this.children, this.onRefresh});

  final String eyebrow;
  final String title;
  final String intro;
  final List<Widget> children;

  /// Pulled down: read again.
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: tabPagePadding(context),
      children: [
        Semantics(
          header: true,
          child: PageHead(eyebrow: eyebrow, title: title, intro: intro),
        ),
        const SizedBox(height: 24),
        for (final (i, child) in children.indexed) ...[if (i > 0) const SizedBox(height: 12), child],
      ],
    );
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}
