import { Button } from '@/components/ui/button';
import { EXPERT_COPY } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';

export function ExpertEditorFooter({
  onClose,
  onApply,
  disabled,
}: {
  onClose: () => void;
  onApply: () => void;
  disabled: boolean;
}) {
  return (
    <div className={layout.expert.editorFooter}>
      <Button variant="outline" size="multiline" onClick={onClose}>
        {EXPERT_COPY.cancel}
      </Button>
      <Button size="multiline" onClick={onApply} disabled={disabled}>
        {EXPERT_UI_COPY.apply}
      </Button>
    </div>
  );
}
