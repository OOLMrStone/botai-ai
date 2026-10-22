import { MockExamCatalog } from '@/components/mock-exams/MockExamCatalog';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { MOCK_EXAM_COPY, MOCK_EXAM_LAYOUT } from '@/config/mock-exams';

export default function MockExamsPage() {
  return (
    <ScreenShell bottomNavigation className={MOCK_EXAM_LAYOUT.page}>
      <ScreenHeading variant="app" title={MOCK_EXAM_COPY.title} />
      <MockExamCatalog />
    </ScreenShell>
  );
}
