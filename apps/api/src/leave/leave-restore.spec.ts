import { statusBeforeCancel } from '@trendlix/shared';
import { leaveRestoreComment } from './leave-edit.js';

// A Super Admin undoing a cancellation (owner, 26 October 2026: "allow superadmin to undo cancellation").

const step = (kind: string, decision?: 'approve' | 'reject') => ({ kind, decision: decision ?? null });

describe('where a cancelled leave goes back to', () => {
  it('approved when HR recorded it, or HR approved it', () => {
    expect(statusBeforeCancel([step('recorded_by_hr'), step('cancelled')], true)).toBe('approved');
    expect(statusBeforeCancel([step('submitted'), step('manager_decision', 'approve'), step('hr_decision', 'approve'), step('cancelled')], false)).toBe('approved');
  });

  it('the step its employee withdrew it from', () => {
    expect(statusBeforeCancel([step('submitted'), step('cancelled')], false)).toBe('with_manager');
    expect(statusBeforeCancel([step('submitted'), step('manager_decision', 'approve'), step('cancelled')], false)).toBe('with_hr');
    expect(statusBeforeCancel([step('submitted'), step('no_manager'), step('cancelled')], false)).toBe('with_hr');
  });

  it('edits and cover changes in between do not move it', () => {
    expect(statusBeforeCancel([step('recorded_by_hr'), step('edited'), step('cancelled'), step('edited')], true)).toBe('approved');
    expect(statusBeforeCancel([step('submitted'), step('cover_changed'), step('cancelled')], false)).toBe('with_manager');
  });

  it('a leave restored and cancelled again goes back to where the restore put it', () => {
    expect(statusBeforeCancel([step('submitted'), step('cancelled'), step('restored'), step('manager_decision', 'approve'), step('cancelled')], false)).toBe('with_hr');
    expect(statusBeforeCancel([step('recorded_by_hr'), step('cancelled'), step('restored'), step('cancelled')], true)).toBe('approved');
  });

  it('an imported leave has no steps: HR’s history, approved', () => {
    expect(statusBeforeCancel([step('cancelled')], true)).toBe('approved');
    expect(statusBeforeCancel([step('cancelled')], false)).toBeNull();
  });

  it('nothing when it is not cancelled, or was rejected', () => {
    expect(statusBeforeCancel([step('recorded_by_hr')], true)).toBeNull();
    expect(statusBeforeCancel([step('recorded_by_hr'), step('cancelled'), step('restored')], true)).toBeNull();
    expect(statusBeforeCancel([step('submitted'), step('manager_decision', 'reject')], false)).toBeNull();
  });
});

describe('the restore step’s words', () => {
  it('says where it is back to, the balance it takes below 0, and the note', () => {
    expect(leaveRestoreComment('approved', 0, null)).toBe('Back to approved');
    expect(leaveRestoreComment('with_hr', 0, ' Wrong dates ')).toBe('Back to waiting for HR\nWhy: Wrong dates');
    expect(leaveRestoreComment('with_manager', 0, null)).toBe('Back to waiting for the direct manager');
    expect(leaveRestoreComment('approved', 2, 'Needed')).toBe('Back to approved\nOver the balance by 2 days: allowed by a Super Admin\nWhy: Needed');
  });
});
