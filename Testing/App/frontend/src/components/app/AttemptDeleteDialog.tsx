'use client';

import { Trash2 } from 'lucide-react';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { ATTEMPT_COPY as C } from '@/config/attempts';
import { layout } from '@/config/layout';
import { useAttemptDelete } from '@/hooks/use-attempt-delete';
import type { Attempt } from '@/lib/api/learning-types';

export function AttemptDeleteDialog({ attempt, title }: { attempt: Attempt; title: string }) {
  const { open, changeOpen, deleting, error, remove, cancelRef } = useAttemptDelete(attempt);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={C.deleteLabel(title)}
        className={layout.app.attempts.rename}
        onClick={() => changeOpen(true)}
      >
        <Trash2 aria-hidden="true" className={layout.app.attempts.icon} />
      </Button>
      <DialogSheet
        open={open}
        onOpenChange={changeOpen}
        title={C.deleteTitle}
        closeLabel={C.close}
        initialFocus={cancelRef}
      >
        <div className={layout.app.attempts.renameForm}>
          <p className={layout.typography.description}>{C.deleteDescription(title)}</p>
          {error ? <ErrorNote message={error} /> : null}
          <div className={layout.app.attempts.renameActions}>
            <Button
              ref={cancelRef}
              variant="outline"
              disabled={deleting}
              onClick={() => changeOpen(false)}
            >
              {C.cancel}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
              {deleting ? C.deleting : C.deleteAction}
            </Button>
          </div>
        </div>
      </DialogSheet>
    </>
  );
}
