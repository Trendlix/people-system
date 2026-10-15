import { companyImage } from '@/lib/company-image';

// Serves the company logo from the API under the web domain, so the API address stays private.
export async function GET() {
  return companyImage('logo');
}
