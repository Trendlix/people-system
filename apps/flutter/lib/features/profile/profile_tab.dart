import 'package:flutter/material.dart';

import '../../shell/app_shell.dart';
import '../../theme/parts.dart';

/// The Profile tab (the phone design, 30 October 2026). Its screens come in this build's next step.
class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: tabPagePadding(context),
      children: const [PageHead(eyebrow: 'People System · Profile', title: 'My Profile')],
    );
  }
}
