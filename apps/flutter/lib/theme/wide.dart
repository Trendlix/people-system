import 'package:flutter/widgets.dart';

import 'tokens.dart';

// iPads and other wide screens (owner, 7 November 2026: "can the app be optimized for ipad screen?"): a page keeps to a
// column in the middle, at most Tokens.pageMaxWidth wide, while its list still scrolls from edge to edge (the room either
// side is the list's own margin); the tiles that sit two across on a phone go four across.

/// [base] with its side margins grown so what it holds is at most [max] wide (margins included), centred.
EdgeInsets centredPadding(BuildContext context, EdgeInsets base, {double max = Tokens.pageMaxWidth}) {
  final extra = (MediaQuery.sizeOf(context).width - max) / 2;
  return extra <= 0 ? base : base.copyWith(left: base.left + extra, right: base.right + extra);
}

/// Whether a box this wide shows four tiles across (an iPad) rather than two (a phone).
bool isWide(double width) => width >= Tokens.wideFrom;
