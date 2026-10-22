import { redirect } from 'next/navigation';
import { VACANCIES_PATH } from './recruitment';

// Recruitment (owner, 22 October 2026: "where will we include the ATS?"): its first page is the vacancies.
export default function RecruitmentPage() {
  redirect(VACANCIES_PATH);
}
