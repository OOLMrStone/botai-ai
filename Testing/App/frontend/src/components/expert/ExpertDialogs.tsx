import { MathFormula } from '@/components/common/MathFormula';
import { ExpertAnalysisEditor } from '@/components/expert/ExpertAnalysisEditor';
import { ExpertBlockEditor } from '@/components/expert/ExpertBlockEditor';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EXPERT_COPY as COPY } from '@/config/expert';
import { EXPERT_UI_COPY as UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useGridStudent, type GridUi, type GridWorkspace } from '@/hooks/use-grid-ui';

export function ExpertDialogs({ workspace, ui }: { workspace: GridWorkspace; ui: GridUi }) {
  const styles = layout.expert;
  const task = workspace.selectedTask;
  const close = () => ui.setDialog(null);
  const student = useGridStudent(workspace, close);

  return (
    <>
      <DialogSheet
        open={ui.dialog === 'student'}
        title={COPY.addStudent}
        closeLabel={COPY.close}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <form
          className={styles.dialogBody}
          onSubmit={(event) => {
            event.preventDefault();
            void student.submit();
          }}
        >
          <label className={styles.inputLabel}>
            {COPY.studentId}
            <Input
              value={student.studentId}
              onChange={(event) => student.setStudentId(event.target.value)}
              required
              disabled={workspace.busy}
            />
          </label>
          <p className={styles.caption}>
            {workspace.session?.mode === 'demo' ? COPY.demoStudentHint : COPY.studentIdHint}
          </p>
          {workspace.error ? (
            <p className={styles.noticeError} role="alert">
              {workspace.error}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button type="button" variant="ghost" onClick={close}>
              {COPY.cancel}
            </Button>
            <Button type="submit" disabled={workspace.busy || !student.studentId.trim()}>
              {COPY.add}
            </Button>
          </div>
        </form>
      </DialogSheet>
      <DialogSheet
        open={ui.dialog === 'criterion'}
        title={COPY.criterion}
        closeLabel={COPY.close}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {task ? (
          <div className={styles.dialogBody}>
            <p className={styles.body}>{task.analysis.criterion}</p>
            {task.analysis.correctAnswer ? (
              <div>
                <span className={styles.label}>{COPY.referenceTitle}</span>
                <MathFormula
                  value={task.analysis.correctAnswer}
                  className={styles.reference}
                  displayMode
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogSheet>
      <DialogSheet
        open={ui.dialog === 'logout'}
        title={UI.cancelEditTitle}
        closeLabel={COPY.close}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <div className={styles.dialogBody}>
          <p className={styles.body}>{UI.cancelEditHint}</p>
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={close}>
              {UI.continueEdit}
            </Button>
            <Button onClick={() => void ui.confirmLogout()}>{COPY.logout}</Button>
          </div>
        </div>
      </DialogSheet>
      {task && (ui.dialog === 'score' || ui.dialog === 'advice' || ui.dialog === 'findings') ? (
        <ExpertAnalysisEditor
          key={`${task.id}-${ui.dialog}`}
          task={task}
          mode={ui.dialog}
          disabled={workspace.busy}
          onApply={(analysis) => {
            const applied = workspace.updateAnalysis(
              ui.dialog === 'score'
                ? { score: analysis.score, verdict: analysis.verdict }
                : ui.dialog === 'advice'
                  ? { advice: analysis.advice }
                  : { findings: analysis.findings },
            );
            if (applied) close();
          }}
          onClose={close}
        />
      ) : null}
      {ui.editingBlock && task ? (
        <ExpertBlockEditor
          key={ui.editingBlock.id}
          block={ui.editingBlock}
          task={task}
          disabled={workspace.busy}
          onApply={(block) => {
            if (workspace.updateBlock(block)) ui.setEditingBlockId(null);
          }}
          onClose={() => ui.setEditingBlockId(null)}
        />
      ) : null}
    </>
  );
}
