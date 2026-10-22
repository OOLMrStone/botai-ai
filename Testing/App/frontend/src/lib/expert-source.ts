import type { ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';

export function expertSources(task: Pick<ExpertTask, 'sourceImages' | 'sourceImage'>) {
  return task.sourceImages?.length
    ? task.sourceImages
    : task.sourceImage
      ? [{ id: task.sourceImage, url: task.sourceImage, name: EXPERT_UI_COPY.sourceAlt }]
      : [];
}
