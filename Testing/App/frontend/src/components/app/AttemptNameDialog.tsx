'use client';

import { Pencil } from 'lucide-react';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ATTEMPT_COPY as C, ATTEMPT_TITLE_MAX_LENGTH } from '@/config/attempts';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { useAttemptName } from '@/hooks/use-attempt-name';
import type { Attempt } from '@/lib/api/learning-types';

export function AttemptNameDialog({ attempt, title }: { attempt: Attempt; title: string }) {
  const { open, changeOpen, name, setName, saving, error, save, inputRef } = useAttemptName(
    attempt,
    title,
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={C.renameLabel(title)}
        className={layout.app.attempts.rename}
        onClick={() => changeOpen(true)}
      >
        <Pencil aria-hidden="true" className={layout.app.attempts.icon} />
      </Button>
      <DialogSheet
        open={open}
        onOpenChange={changeOpen}
        title={C.renameTitle}
        closeLabel={C.close}
        initialFocus={inputRef}
      >
        <form
          className={layout.app.attempts.renameForm}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className={layout.typography.description}>{C.renameHint}</p>
          <Input
            ref={inputRef}
            aria-label={C.nameLabel}
            placeholder={C.namePlaceholder}
            value={name}
            maxLength={ATTEMPT_TITLE_MAX_LENGTH}
            disabled={saving}
            aria-invalid={Boolean(error)}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? <ErrorNote message={error} /> : null}
          <div className={layout.app.attempts.renameActions}>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => changeOpen(false)}
            >
              {C.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? LEARNING_COPY.saving : C.save}
            </Button>
          </div>
        </form>
      </DialogSheet>
    </>
  );
}
