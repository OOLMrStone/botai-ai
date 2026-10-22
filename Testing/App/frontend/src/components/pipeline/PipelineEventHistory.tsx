import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineEvent } from '@/lib/api/pipeline-console-types';
import { pipelineEventAction, pipelineEventDetails, pipelineTime } from '@/lib/pipeline-console';

export function PipelineEventHistory({ events }: { events: PipelineEvent[] }) {
  const styles = layout.pipelineConsole;
  return (
    <div>
      <ol className={styles.eventHistory}>
        {events.map((event) => (
          <li key={event.seq} className={styles.historyEvent}>
            <span className={styles.secondary}>{pipelineEventAction(event)}</span>
            <time className={styles.eventTime} dateTime={event.createdAt}>
              {pipelineTime(event.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      <details>
        <summary className={styles.eventDetails}>{COPY.eventData}</summary>
        <pre className={styles.json}>
          {JSON.stringify(events.map(pipelineEventDetails), null, 2)}
        </pre>
      </details>
    </div>
  );
}
