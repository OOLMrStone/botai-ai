import { LogOut } from 'lucide-react';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY } from '@/config/expert';
import { EXPERT_UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import type { GridUi, GridWorkspace } from '@/hooks/use-grid-ui';
import { cn } from '@/lib/utils';

export function ExpertHeader({
  workspace,
  ui,
  compact = false,
}: {
  workspace: GridWorkspace;
  ui: GridUi;
  compact?: boolean;
}) {
  const styles = layout.expert;

  return (
    <header className={cn(styles.topbar, compact && styles.topbarCompare)}>
      <div className={styles.brand}>
        <Wordmark variant="compact" />
        <span className={styles.brandDivider} aria-hidden="true" />
        <span className={styles.product}>{COPY.expert}</span>
      </div>
      {workspace.session ? (
        <div className={styles.account}>
          <nav className={styles.navigation} aria-label={COPY.expert}>
            {EXPERT_UI.navigation.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="compact"
                className={cn(styles.navButton, workspace.view === item.id && styles.navActive)}
                onClick={() => workspace.setView(item.id)}
                aria-current={workspace.view === item.id ? 'page' : undefined}
              >
                {item.label}
              </Button>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="icon-compact"
            onClick={ui.logout}
            aria-label={COPY.logout}
            disabled={workspace.busy}
          >
            <LogOut aria-hidden="true" />
          </Button>
          <span className={styles.avatar} aria-label={workspace.session.name}>
            {workspace.session.initials}
          </span>
        </div>
      ) : null}
    </header>
  );
}
