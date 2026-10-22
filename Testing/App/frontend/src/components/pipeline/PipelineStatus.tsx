import { Check, Circle, CircleAlert, Minus } from 'lucide-react';
import { PIPELINE_STATE_COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineRunState } from '@/lib/api/pipeline-console-types';
import { pipelineStateTone } from '@/lib/pipeline-console';
import { cn } from '@/lib/utils';

export function PipelineStatus({ state }: { state: PipelineRunState }) {
  const styles = layout.pipelineConsole;
  const tone = pipelineStateTone(state);
  const Icon =
    tone === 'success'
      ? Check
      : tone === 'failure'
        ? CircleAlert
        : tone === 'muted'
          ? Minus
          : Circle;
  return (
    <span className={cn(styles.status, styles[tone])}>
      <Icon className={styles.statusIcon} aria-hidden="true" />
      {PIPELINE_STATE_COPY[state]}
    </span>
  );
}
