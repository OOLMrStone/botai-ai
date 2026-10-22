import { ExpertEditorFooter } from '@/components/expert/ExpertEditorFooter';
import { ExpertPhotoViewer } from '@/components/expert/ExpertPhotoViewer';
import { ExpertCausePicker } from '@/components/expert/ExpertCausePicker';
import { ExpertSelect } from '@/components/expert/ExpertSelect';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { ExpertGeometryEditor } from '@/components/expert/ExpertGeometryEditor';
import { ExpertRichTextEditor } from '@/components/expert/ExpertRichTextEditor';
import { ExpertStepImage } from '@/components/expert/ExpertStepContent';
import { ExpertStepTextEditor } from '@/components/expert/ExpertStepTextEditor';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import {
  EXPERT_COPY as COPY,
  EXPERT_STATUS_OPTIONS,
  type ExpertBlock,
  type ExpertTask,
} from '@/config/expert';
import { EXPERT_UI_COPY as UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useGridBlockEditor } from '@/hooks/use-grid-editor';
import { cn } from '@/lib/utils';

export function ExpertBlockEditor({
  block: initial,
  task,
  onApply,
  onClose,
  disabled = false,
}: {
  block: ExpertBlock;
  task: ExpertTask;
  onApply: (block: ExpertBlock) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const editor = useGridBlockEditor(initial, task, onApply);
  const { block } = editor;
  const styles = layout.expert;
  const hasPhoto = Boolean(task.sourceImages?.length || task.sourceImage);
  const showPhoto = editor.showPhoto && hasPhoto;

  return (
    <DialogSheet
      open
      title={UI.editRecognition}
      closeLabel={COPY.close}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={cn(styles.wideEditor, showPhoto && styles.compareEditor)}
      headerActions={
        hasPhoto ? (
          <Button
            variant="ghost"
            size="compact"
            aria-label={editor.showPhoto ? UI.hideSource : UI.sourceCompare}
            onClick={editor.togglePhoto}
          >
            <ImageIcon />
            <span className={styles.photoExternalLabel}>
              {editor.showPhoto ? UI.hideSource : UI.sourceCompare}
            </span>
          </Button>
        ) : null
      }
    >
      <div className={styles.editorBody}>
        <div className={cn(styles.editorWorkspace, showPhoto && styles.editorWorkspaceCompare)}>
          {showPhoto ? <ExpertPhotoViewer task={task} variant="compare" /> : null}
          <div className={styles.editorForm}>
            <div className={styles.editorSection}>
              <p className={styles.editorHeading}>{block.title}</p>
              {block.kind === 'math' ? (
                <div className={styles.editorSection}>
                  {block.formulas.map((formula, index) => (
                    <div key={editor.formulaIds[index]} className={styles.editorRow}>
                      <div className={styles.editorField}>
                        <ExpertMathField
                          value={formula}
                          onChange={(value) => editor.setFormula(index, value)}
                          label={UI.formula(index)}
                          onValidityChange={(valid) => editor.setFormulaValid(index, valid)}
                        />
                      </div>
                      {block.formulas.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="icon-compact"
                          onClick={() => editor.removeFormula(index)}
                          aria-label={UI.removeFormula}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <Button variant="outline" onClick={editor.addFormula}>
                    <Plus />
                    {UI.addFormula}
                  </Button>
                </div>
              ) : null}
              {block.kind === 'text' ? (
                <ExpertRichTextEditor
                  value={block.text}
                  onChange={editor.setText}
                  label={UI.recognizedText}
                  onValidityChange={editor.setRichTextValid}
                />
              ) : null}
              {block.kind === 'step' ? (
                <ExpertStepTextEditor
                  block={block}
                  onChange={editor.setText}
                  onValidityChange={editor.setRichTextValid}
                />
              ) : null}
              {block.kind === 'step' && block.image ? (
                <ExpertStepImage image={block.image} />
              ) : null}
              {editor.diagram ? (
                <ExpertGeometryEditor
                  key={block.id}
                  diagram={editor.diagram}
                  onChange={editor.setDiagram}
                  onValidityChange={editor.setGeometryValid}
                  allowPresentation={false}
                />
              ) : null}
            </div>
            <label className={styles.inputLabel}>
              {UI.stepStatus}
              <ExpertSelect
                value={block.status ?? ''}
                onChange={(event) => editor.setStatus(event.target.value)}
              >
                {EXPERT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value ?? ''} value={option.value ?? ''}>
                    {option.label}
                  </option>
                ))}
              </ExpertSelect>
            </label>
            {block.status === 'follow_through' ? (
              <ExpertCausePicker
                candidates={editor.errorSources}
                selectedIds={block.followsFromBlockIds ?? []}
                onToggle={editor.toggleErrorSource}
                onMarkError={editor.markErrorHere}
                valid={editor.causesValid}
              />
            ) : null}
            <label className={styles.inputLabel}>
              {UI.stepExplanation}
              <textarea
                className={cn(styles.textarea, styles.smallTextarea)}
                value={block.explanation}
                onChange={(event) => editor.setCommon({ explanation: event.target.value })}
              />
            </label>
          </div>
        </div>
        <ExpertEditorFooter
          onClose={onClose}
          onApply={editor.apply}
          disabled={disabled || !editor.canApply}
        />
      </div>
    </DialogSheet>
  );
}
