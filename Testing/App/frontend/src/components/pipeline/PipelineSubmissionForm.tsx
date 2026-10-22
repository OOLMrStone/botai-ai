import { FileImage, Plus, X } from 'lucide-react';
import { ErrorNote } from '@/components/common/ErrorNote';
import { FileUploadButton } from '@/components/common/FileUploadButton';
import { FormSection } from '@/components/common/FormSection';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineSubmission } from '@/hooks/use-pipeline-submission';

function SelectedFile({
  name,
  busy,
  onRemove,
}: {
  name: string;
  busy: boolean;
  onRemove: () => void;
}) {
  const styles = layout.pipelineConsole;
  return (
    <div className={styles.file}>
      <FileImage className={styles.statusIcon} aria-hidden="true" />
      <span className={styles.fileName}>{name}</span>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={COPY.remove}
        disabled={busy}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

export function PipelineSubmissionForm({ form }: { form: PipelineSubmission }) {
  const styles = layout.pipelineConsole;
  return (
    <DialogSheet
      open={form.open}
      title={COPY.newRun}
      closeLabel={COPY.close}
      onOpenChange={form.close}
      className={styles.dialog}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      >
        <FormSection title={COPY.selectTask}>
          <div className={styles.numberOptions}>
            {CONFIG.taskNumbers.map((number) => (
              <Button
                key={number}
                type="button"
                variant={form.taskNumber === number ? 'default' : 'outline'}
                aria-pressed={form.taskNumber === number}
                disabled={form.busy}
                onClick={() => form.selectNumber(number)}
              >
                {COPY.taskNumber(number)}
              </Button>
            ))}
          </div>
        </FormSection>
        <FormSection title={COPY.taskInput}>
          <p className={styles.secondary}>{COPY.taskHint}</p>
          {form.taskImage ? (
            <SelectedFile name={form.taskImage.name} busy={form.busy} onRemove={form.removeTask} />
          ) : null}
          <FileUploadButton
            variant="outline"
            onAdd={form.addTask}
            label={form.taskImage ? COPY.replaceTask : COPY.attachTask}
            accept={CONFIG.accept}
            disabled={form.busy}
          />
        </FormSection>
        <FormSection title={COPY.studentInput}>
          <p className={styles.secondary}>{COPY.solutionHint}</p>
          <div className={styles.fileList}>
            {form.solutionImages.map((file, index) => (
              <SelectedFile
                key={`${file.name}-${index}`}
                name={`${index + 1}. ${file.name}`}
                busy={form.busy}
                onRemove={() => form.removeSolution(index)}
              />
            ))}
          </div>
          <FileUploadButton
            variant="outline"
            onAdd={form.addSolutions}
            label={COPY.attachSolution}
            accept={CONFIG.accept}
            multiple
            disabled={form.busy || form.solutionImages.length >= CONFIG.maxSolutionImages}
          />
        </FormSection>
        {form.error ? <ErrorNote message={form.error} /> : null}
        {form.uncertain ? <p className={styles.secondary}>{COPY.uncertain}</p> : null}
        <p className={styles.secondary}>{COPY.manualHint}</p>
        <div className={styles.formFooter}>
          <Button
            type="button"
            variant="ghost"
            size="multiline"
            onClick={() => form.close(false)}
            disabled={form.busy}
          >
            {COPY.cancel}
          </Button>
          <Button
            type="submit"
            size="multiline"
            className={styles.formFooterAction}
            disabled={form.busy || !form.taskImage || !form.solutionImages.length}
          >
            {form.busy ? COPY.submitting : COPY.start}
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </form>
    </DialogSheet>
  );
}
