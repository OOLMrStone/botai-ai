import { ExpertEditorFooter } from '@/components/expert/ExpertEditorFooter';
import { ErrorNote } from '@/components/common/ErrorNote';
import { ExpertSelect } from '@/components/expert/ExpertSelect';
import { gridScoreOptions } from '@/lib/grid-view';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogSheet } from '@/components/ui/dialog';
import { EXPERT_COPY as COPY, type ExpertAnalysis, type ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY as UI, type GridAnalysisMode } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useGridAnalysisEditor } from '@/hooks/use-grid-editor';

import { expertFindingNeedsReview } from '@/lib/expert';
import { cn } from '@/lib/utils';

export function ExpertAnalysisEditor({
  task,
  mode,
  onApply,
  onClose,
  disabled = false,
}: {
  task: ExpertTask;
  mode: GridAnalysisMode;
  onApply: (analysis: ExpertAnalysis) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const editor = useGridAnalysisEditor(task, mode, onApply);
  const styles = layout.expert;
  const { analysis } = editor;
  const title =
    mode === 'score' ? COPY.editVerdict : mode === 'advice' ? COPY.editAdvice : UI.editFindings;

  return (
    <DialogSheet
      open
      title={title}
      closeLabel={COPY.close}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={styles.editor}
    >
      <div className={styles.editorBody}>
        {mode === 'score' ? (
          <>
            <div className={styles.stack}>
              <span className={styles.label}>{COPY.scoreLabel}</span>
              <div className={styles.scoreOptions}>
                {gridScoreOptions(task).map((score) => (
                  <Button
                    key={score}
                    size="icon"
                    variant={analysis.score === score ? 'default' : 'outline'}
                    aria-pressed={analysis.score === score}
                    onClick={() => editor.update({ score })}
                  >
                    {score}
                  </Button>
                ))}
              </div>
            </div>
            <label className={styles.inputLabel}>
              {COPY.verdictLabel}
              <textarea
                className={styles.textarea}
                value={analysis.verdict}
                onChange={(event) => editor.update({ verdict: event.target.value })}
              />
            </label>
          </>
        ) : null}
        {mode === 'advice' ? (
          <label className={styles.inputLabel}>
            {COPY.adviceLabel}
            <textarea
              className={styles.textarea}
              value={analysis.advice}
              onChange={(event) => editor.update({ advice: event.target.value })}
            />
          </label>
        ) : null}
        {mode === 'findings' ? (
          <>
            {analysis.findings.map((finding) => (
              <div className={styles.geometryCard} key={finding.id}>
                <div className={styles.spread}>
                  <span className={styles.label}>{UI.findingTitle}</span>
                  <Button
                    size="icon-compact"
                    variant="ghost"
                    onClick={() => editor.removeFinding(finding.id)}
                    aria-label={UI.removeFinding}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {expertFindingNeedsReview(task, finding) ? (
                  <p className={styles.unsaved}>{UI.findingReviewHint}</p>
                ) : null}
                <Input
                  value={finding.title}
                  aria-label={UI.findingTitle}
                  onChange={(event) =>
                    editor.updateFinding(finding.id, { title: event.target.value })
                  }
                />
                <label className={styles.inputLabel}>
                  {UI.findingDescription}
                  <textarea
                    className={cn(styles.textarea, styles.smallTextarea)}
                    value={finding.description}
                    onChange={(event) =>
                      editor.updateFinding(finding.id, { description: event.target.value })
                    }
                  />
                </label>
                <div className={styles.editorGrid}>
                  <label className={styles.inputLabel}>
                    {UI.findingStep}
                    <ExpertSelect
                      value={finding.blockId}
                      onChange={(event) =>
                        editor.updateFinding(finding.id, { blockId: event.target.value })
                      }
                    >
                      <option value="">{UI.globalFinding}</option>
                      {task.blocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.title}
                        </option>
                      ))}
                    </ExpertSelect>
                  </label>
                  {editor.canEditDeductions ? (
                    <label className={styles.inputLabel}>
                      {UI.findingDeduction}
                      <Input
                        type="number"
                        min={0}
                        max={task.analysis.maxScore}
                        value={finding.deduction ?? ''}
                        onChange={(event) =>
                          editor.updateFinding(finding.id, {
                            deduction:
                              event.target.value === '' ? undefined : event.target.valueAsNumber,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={editor.addFinding} disabled={!task.blocks.length}>
              <Plus />
              {UI.addFinding}
            </Button>
            {editor.deductionError ? <ErrorNote message={editor.deductionError} /> : null}
          </>
        ) : null}
        <ExpertEditorFooter
          onClose={onClose}
          onApply={editor.apply}
          disabled={disabled || !editor.canApply}
        />
      </div>
    </DialogSheet>
  );
}
