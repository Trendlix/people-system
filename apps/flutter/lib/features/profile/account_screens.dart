import 'package:flutter/material.dart';

import '../../shell/app_shell.dart';
import '../../theme/parts.dart';

/// The account's screens under Profile (the phone design: Change Password, Profile Image, Your Sessions, Your Interview
/// Hours). Their content comes in this build's next step.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key, required this.eyebrow, required this.title});

  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: tabPagePadding(context),
      children: [PageHead(eyebrow: eyebrow, title: title)],
    );
  }
}
