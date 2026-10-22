import { SchoolWorkspace } from '@/components/school/SchoolWorkspace';
import { b2bMetadata } from '@/config/b2b';
import { SCHOOL_COPY } from '@/config/school';

export const metadata = b2bMetadata(SCHOOL_COPY.product, SCHOOL_COPY.loginSubtitle);

export default function SchoolPage() {
  return <SchoolWorkspace />;
}
