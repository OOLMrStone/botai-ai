import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';

interface TrainingExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (remove: boolean) => void;
}

export function TrainingExitDialog({ open, onOpenChange, onFinish }: TrainingExitDialogProps) {
  return (
    <DialogSheet
      open={open}
      title={TASK_COPY.favorites.removeTitle}
      closeLabel={TASK_COPY.close}
      className={layout.training.exitSheet}
      onOpenChange={onOpenChange}
    >
      <div className={layout.training.exitActions}>
        <Button
          variant="outline"
          className={layout.training.exitAction}
          onClick={() => onFinish(false)}
        >
          {TASK_COPY.favorites.keep}
        </Button>
        <Button className={layout.training.exitAction} onClick={() => onFinish(true)}>
          {TASK_COPY.favorites.remove}
        </Button>
      </div>
    </DialogSheet>
  );
}
