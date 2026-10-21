import { describe, expect, it } from 'vitest';
import { CLAUDE_NEW_CHAT, claudeRegisterHref, claudeRegisterPrompt } from './claude-register';

describe('Register with Claude (owner, 21 October 2026: "add register with claude")', () => {
  it('asks Claude to draft the asset through the connector from the attached photos, the serial never guessed', () => {
    const prompt = claudeRegisterPrompt();
    expect(prompt).toContain('Trendlix People connector');
    expect(prompt).toContain('photos');
    expect(prompt).toContain('serial exactly as printed');
    expect(prompt).toContain("draft's link");
  });

  it('opens a new Claude chat with the instruction filled in, encoded', () => {
    const href = claudeRegisterHref('Room: Studio A & B');
    expect(href.startsWith(`${CLAUDE_NEW_CHAT}?q=`)).toBe(true);
    expect(new URL(href).searchParams.get('q')).toBe('Room: Studio A & B');
    expect(new URL(claudeRegisterHref()).searchParams.get('q')).toBe(claudeRegisterPrompt());
  });
});
