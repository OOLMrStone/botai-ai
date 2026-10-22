import { ArrowRight, CheckCheck } from 'lucide-react';
import { AppCard } from '@/components/app/AppCard';
import { AttemptNameDialog } from '@/components/app/AttemptNameDialog';
import { AttemptDeleteDialog } from '@/components/app/AttemptDeleteDialog';
import { SectionHeading } from '@/components/common/SectionHeading';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import type { Attempt } from '@/lib/api/learning-types';
import type { attemptCardContent } from '@/lib/attempt-list';

interface AttemptCardProps {
  attempt: Attempt;
  content: ReturnType<typeof attemptCardContent>;
  onOpen: (id: string) => void;
}

export function AttemptCard({ attempt, content, onOpen }: AttemptCardProps) {
  return (
    <AppCard className={layout.app.attempts.card}>
      <div className={layout.app.attempts.cardContent}>
        <p className={layout.app.attempts.metadata}>
          {content.kind}
          <span aria-hidden="true"> · </span>
          {content.date}
        </p>
        <div className={layout.app.attempts.titleRow}>
          <div className={layout.app.attempts.title}>
            <SectionHeading>{content.title}</SectionHeading>
          </div>
          <AttemptNameDialog attempt={attempt} title={content.title} />
          <AttemptDeleteDialog attempt={attempt} title={content.title} />
        </div>
        <p className={layout.app.attempts.summary}>
          {content.completed ? (
            <CheckCheck className={layout.app.attempts.icon} aria-hidden="true" />
          ) : null}
          {content.summary}
        </p>
      </div>
      <Button
        variant={content.completed ? 'outline' : 'default'}
        className={layout.app.attempts.action}
        onClick={() => onOpen(attempt.id)}
      >
        {content.action}
        <ArrowRight className={layout.app.attempts.icon} aria-hidden="true" />
      </Button>
    </AppCard>
  );
}
