// "Register with Claude" (owner, 21 October 2026: "add register with claude"): a person adding an asset in the system,
// on the site or in the app, is sent to Claude with the instruction ready. The Trendlix People connector is on their own
// Claude account ("the connection method"), so the photos are read there and Claude drafts the asset; the person comes
// back to Drafts From Claude to add the photos and save. The instruction rides in claude.ai's new-chat address (q=) and
// is copied to the clipboard as well, in case Claude opens without it.

/** Where a new Claude chat opens, with the instruction filled in. */
export const CLAUDE_NEW_CHAT = 'https://claude.ai/new';

/** The instruction for Claude: read the attached photos and draft the asset through the connector. */
export function claudeRegisterPrompt(): string {
  return [
    'Register a new asset in Trendlix People with the Trendlix People connector.',
    "I'm attaching photos of it, and of its label or nameplate if it has one.",
    'Read the photos and fill in what you can: the name, group, type, brand, model, the serial exactly as printed (leave it empty if it is not readable), the condition and notes.',
    // step 4 (owner, 22 October 2026: accessories, "Both kinds")
    'List the accessories that come with it (a charger, cables, a case); if it is itself an accessory of another asset, say which one by its code.',
    "Ask me which room it is in if I haven't said, then create the draft and give me the draft's link.",
  ].join(' ');
}

/** The new-chat address with the instruction in it. */
export function claudeRegisterHref(prompt: string = claudeRegisterPrompt()): string {
  return `${CLAUDE_NEW_CHAT}?q=${encodeURIComponent(prompt)}`;
}
