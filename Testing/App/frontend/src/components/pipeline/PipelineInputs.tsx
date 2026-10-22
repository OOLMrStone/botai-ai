import { ChevronDown, Download } from 'lucide-react';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { PipelineImage } from '@/components/pipeline/PipelineImage';
import { TaskBlockRenderer } from '@/components/tasks/TaskBlockRenderer';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineRunDetail } from '@/lib/api/pipeline-console-types';
import { pipelinePrivateUrl } from '@/lib/pipeline-console';

export function PipelineInputs({ run }: { run: PipelineRunDetail }) {
  const styles = layout.pipelineConsole;
  return (
    <details className={styles.disclosure}>
      <summary className={styles.summary}>
        {COPY.inputs}
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.disclosureBody}>
        <p className={styles.sectionTitle}>{COPY.taskInput}</p>
        {run.task.inputImage ? (
          <PipelineImage src={run.task.inputImage.previewUrl} title={COPY.taskInput} />
        ) : null}
        {run.task.content.length ? (
          <TaskBlockRenderer blocks={run.task.content} />
        ) : run.task.statement ? (
          <ExpertRichText value={run.task.statement} />
        ) : null}
        {run.task.referenceAnswer ? (
          <div className={styles.section}>
            <p className={styles.secondary}>{COPY.referenceAnswer}</p>
            <ExpertRichText value={run.task.referenceAnswer} />
          </div>
        ) : null}
        {run.task.referenceSolution ? (
          <div className={styles.section}>
            <p className={styles.secondary}>{COPY.referenceSolution}</p>
            <ExpertRichText value={run.task.referenceSolution} />
          </div>
        ) : null}
        <p className={styles.sectionTitle}>{COPY.studentInput}</p>
        <div className={styles.mediaGrid}>
          {run.images.map((image, index) => (
            <PipelineImage key={image.id} src={image.previewUrl} title={COPY.image(index)} />
          ))}
        </div>
        {run.documents.map((document) => {
          const url = pipelinePrivateUrl(document.downloadUrl);
          return url ? (
            <a key={document.id} href={url} className={styles.status}>
              <Download className={styles.statusIcon} aria-hidden="true" />
              {COPY.downloadPdf}
            </a>
          ) : null;
        })}
      </div>
    </details>
  );
}
