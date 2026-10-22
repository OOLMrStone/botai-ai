import { ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EXPERT_SOURCE_COPY } from '@/config/expert-source-layout';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';

export function ExpertSource({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      size="compact"
      variant="ghost"
      className={layout.expertSource.trigger}
      onClick={onOpen}
      aria-expanded={false}
      aria-label={EXPERT_UI_COPY.sourceOriginal}
    >
      <ImageIcon aria-hidden="true" />
      <span className={layout.expertSource.shortLabel}>{EXPERT_SOURCE_COPY.shortTitle}</span>
      <span className={layout.expertSource.fullLabel}>{EXPERT_UI_COPY.sourceOriginal}</span>
    </Button>
  );
}
