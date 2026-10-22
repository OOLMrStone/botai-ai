import { ChevronDown } from 'lucide-react';
import { PipelineImage } from '@/components/pipeline/PipelineImage';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineArtifact as Artifact } from '@/lib/api/pipeline-console-types';

export function PipelineArtifact({ artifact }: { artifact: Artifact }) {
  const styles = layout.pipelineConsole;
  return (
    <details className={styles.disclosure}>
      <summary className={styles.summary}>
        {COPY.artifactKind[artifact.kind]}
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.disclosureBody}>
        {artifact.state === 'unavailable' ? (
          <p className={styles.secondary}>{COPY.artifactUnavailable}</p>
        ) : (
          <>
            {artifact.previewUrl ? (
              <PipelineImage src={artifact.previewUrl} title={COPY.artifactKind[artifact.kind]} />
            ) : null}
            {artifact.document ? (
              <pre className={styles.json}>{JSON.stringify(artifact.document, null, 2)}</pre>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}
