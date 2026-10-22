import { LogOut } from 'lucide-react';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { Button } from '@/components/ui/button';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolWorkspace } from '@/hooks/use-school-workspace';

export function SchoolHeader({ workspace }: { workspace: SchoolWorkspace }) {
  return (
    <header className={layout.expert.topbar}>
      <div className={layout.expert.brand}>
        <Wordmark variant="compact" />
        <span className={layout.expert.brandDivider} aria-hidden="true" />
        <span className={layout.expert.product}>{C.product}</span>
      </div>
      {workspace.session ? (
        <div className={layout.expert.account}>
          <span className={layout.school.accountName}>
            {workspace.session.displayName ?? workspace.session.email}
          </span>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={C.logout}
            disabled={workspace.busy}
            onClick={() => void workspace.logout()}
          >
            <LogOut aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </header>
  );
}
