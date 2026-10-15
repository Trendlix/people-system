import { companyImage } from '@/lib/company-image';

// Serves the company thumbnail (the square brand mark beside the logo, owner's request, 15 October 2026) from the API
// under the web domain, like the logo: the browser tab icon, and the mark where the logo has no room.
export async function GET() {
  return companyImage('thumbnail');
}
