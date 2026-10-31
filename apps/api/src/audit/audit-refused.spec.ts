import { isRecordedRefusal, moduleOfPath, refusalMessage, refusedEntry } from './audit-refused.js';

// What a signed-in person tried and was refused (owner, 31 October 2026: "Also log what someone tried and was refused
// (no permission, a locked month, a rule broken)"): which answers are written, on which module, and never what was sent.

describe('refused attempts', () => {
  it('records a change refused with 400, 403, 404, 409 or 422', () => {
    for (const status of [400, 403, 404, 409, 422]) expect(isRecordedRefusal('POST', status, '/api/leave/requests/:id/approve')).toBe(true);
    for (const method of ['PUT', 'PATCH', 'DELETE', 'patch']) expect(isRecordedRefusal(method, 403, '/api/employees/:id')).toBe(true);
  });

  it('not a look, a success, signed out, the server’s fault, or the log’s, sign-in’s and public addresses', () => {
    expect(isRecordedRefusal('GET', 403, '/api/payroll/runs')).toBe(false);
    for (const status of [200, 201, 204, 401, 429, 500, 503]) expect(isRecordedRefusal('POST', status, '/api/payroll/runs')).toBe(false);
    for (const path of ['/api/audit', '/api/audit/export', '/api/auth/login', '/api/auth/logout', '/api/auth/email-code/sign-in', '/api/auth/devices/sign-in', '/api/auth/forgot-password', '/api/public/careers/apply', '/api/connector/oauth/token'])
      expect(isRecordedRefusal('POST', 400, path)).toBe(false);
    expect(isRecordedRefusal('POST', 400, '/api/auth/change-password')).toBe(true);
    expect(isRecordedRefusal('POST', 400, '/api/auditors')).toBe(true);
    expect(isRecordedRefusal('POST', 400, null)).toBe(false);
  });

  it('finds the module by the address', () => {
    expect(moduleOfPath('/api/leave/requests/:id/approve')).toBe('leave');
    expect(moduleOfPath('/api/me/leave')).toBe('leave');
    expect(moduleOfPath('/api/me/attendance/corrections')).toBe('attendance');
    expect(moduleOfPath('/api/me')).toBe('employees');
    expect(moduleOfPath('/api/employees/:employeeId/check-in-exemptions')).toBe('attendance');
    expect(moduleOfPath('/api/employees/:id/employments/:employmentId/endings')).toBe('lifecycle');
    expect(moduleOfPath('/api/employees/:id/employments/:employmentId/contracts')).toBe('employees');
    expect(moduleOfPath('/api/payroll/holidays/:id')).toBe('attendance');
    expect(moduleOfPath('/api/payroll/runs/:id/approve')).toBe('payroll');
    expect(moduleOfPath('/api/assets/custody/:id/return')).toBe('assets');
    expect(moduleOfPath('/api/recruitment/vacancies')).toBe('recruitment');
    expect(moduleOfPath('/api/kpis/templates/:id')).toBe('kpis');
    expect(moduleOfPath('/api/users/:id/roles')).toBe('access');
    expect(moduleOfPath('/api/reports/turnover')).toBe('other');
  });

  it('writes the method, the address’s pattern, the status and the message: never what was sent', () => {
    const id = '0B8F0C1E-2D3A-4B5C-8D9E-0F1A2B3C4D5E';
    const entry = refusedEntry('u1', 'post', '/api/payroll/runs/:id/approve', 409, { id }, { statusCode: 409, message: 'October 2026 is locked.', password: 'x' });
    expect(entry).toEqual({
      userId: 'u1',
      action: 'refused',
      entityType: 'payroll',
      entityId: id.toLowerCase(),
      diff: { method: 'POST', path: '/api/payroll/runs/:id/approve', status: 409, message: 'October 2026 is locked.' },
    });
    expect(refusedEntry('u1', 'PATCH', '/api/grades/:id', 404, { id: 'G1' }, null).entityId).toBeNull();
    expect(refusalMessage({ message: ['Enter the name.', 'Choose a grade.'] })).toBe('Enter the name. Choose a grade.');
    expect(refusalMessage({ message: 'x'.repeat(900) })).toHaveLength(500);
    expect(refusalMessage('text')).toBeNull();
    expect(refusalMessage({ error: 'Forbidden' })).toBeNull();
  });
});
