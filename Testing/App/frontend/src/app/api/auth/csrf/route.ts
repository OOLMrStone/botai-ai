import { issueCsrf } from '@/app/api/_mock/auth';

export function GET() {
  return issueCsrf();
}
