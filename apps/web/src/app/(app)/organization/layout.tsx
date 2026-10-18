import { StaffOnly } from '../staff-only';

// Not an employee's: someone who is only an employee and/or a direct manager is sent to their dashboard (owner, 17
// October 2026: "dont show him the organization tab").
export default function OrganizationLayout({ children }: LayoutProps<'/organization'>) {
  return (
    <StaffOnly>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-semibold">Organization</h1>
        <p className="mt-1 text-muted">Company details, departments with their teams and the job titles in each (and their job descriptions), grades, work shifts, the official holidays, the leave types with the year closing, the kinds of allowance paid on top of the salary, how contracts start and end, and the payroll setup.</p>
        {children}
      </div>
    </StaffOnly>
  );
}
