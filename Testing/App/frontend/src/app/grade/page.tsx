import { ExpertWorkspace } from '@/components/expert/ExpertWorkspace';
import { b2bMetadata } from '@/config/b2b';
import { EXPERT_COPY } from '@/config/expert';

export const metadata = b2bMetadata(EXPERT_COPY.loginTitle, EXPERT_COPY.loginSubtitle);

export default function ExpertPage() {
  return <ExpertWorkspace />;
}
