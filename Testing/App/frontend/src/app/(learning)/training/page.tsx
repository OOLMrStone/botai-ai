import { Suspense } from 'react';
import { TrainingExperience } from '@/components/tasks/TrainingExperience';
export default function TrainingPage() {
  return (
    <Suspense>
      <TrainingExperience />
    </Suspense>
  );
}
