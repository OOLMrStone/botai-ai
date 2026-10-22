import { Check, ChevronDown, Circle, CircleAlert } from 'lucide-react';
import { PipelineEventHistory } from '@/components/pipeline/PipelineEventHistory';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineEvent } from '@/lib/api/pipeline-console-types';
import {
  pipelineEventDetails,
  groupPipelineEvents,
  pipelineEventLabel,
  pipelineEventTone,
  pipelineTime,
} from '@/lib/pipeline-console';
import { cn } from '@/lib/utils';

export function PipelineStages({ events }: { events: PipelineEvent[] }) {
  const styles = layout.pipelineConsole;
  const timeline = groupPipelineEvents(events);
  return (
    <section className={styles.section} aria-label={COPY.events}>
      <p className={styles.sectionTitle}>{COPY.events}</p>
      {events.length ? (
        <ol className={styles.timeline}>
          {timeline.map((entry) => {
            const event = entry.summary;
            const first = entry.events[0];
            const tone = pipelineEventTone(event);
            const Icon = tone === 'success' ? Check : tone === 'failure' ? CircleAlert : Circle;
            return (
              <li key={first.seq} className={styles.event}>
                <span className={styles.eventRail} aria-hidden="true" />
                <span className={cn(styles.eventDot, styles[tone])}>
                  <Icon className={styles.statusIcon} aria-hidden="true" />
                </span>
                <div className={styles.eventBody}>
                  <details className={styles.eventDisclosure}>
                    <summary className={styles.eventSummary}>
                      <span className={styles.eventLabel}>{pipelineEventLabel(event)}</span>
                      <ChevronDown className={styles.eventChevron} aria-hidden="true" />
                    </summary>
                    {entry.kind === 'stage' ? (
                      <PipelineEventHistory events={entry.events} />
                    ) : (
                      <pre className={styles.json}>
                        {JSON.stringify(pipelineEventDetails(event), null, 2)}
                      </pre>
                    )}
                  </details>
                </div>
                <time className={styles.eventTime} dateTime={first.createdAt}>
                  {pipelineTime(first.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.secondary}>{COPY.noEvents}</p>
      )}
      {events.length >= CONFIG.eventDisplayLimit ? (
        <p className={styles.secondary}>{COPY.olderEvents}</p>
      ) : null}
    </section>
  );
}
