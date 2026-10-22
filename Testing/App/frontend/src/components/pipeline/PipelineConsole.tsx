'use client';

import { LogOut } from 'lucide-react';
import { B2bLogin } from '@/components/b2b/B2bLogin';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { PipelineWorkspace } from '@/components/pipeline/PipelineWorkspace';
import { Button } from '@/components/ui/button';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import { useB2bLogin } from '@/hooks/use-b2b-login';
import { usePipelineConsole } from '@/hooks/use-pipeline-console';

export function PipelineConsole() {
  const workspace = usePipelineConsole();
  const login = useB2bLogin(workspace.login);
  const styles = layout.pipelineConsole;
  return (
    <div className={styles.root}>
      <header className={layout.expert.topbar}>
        <div className={layout.expert.brand}>
          <Wordmark variant="compact" />
          <span className={layout.expert.brandDivider} aria-hidden="true" />
          <span className={layout.expert.product}>{COPY.title}</span>
        </div>
        {workspace.hasSession ? (
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={COPY.logout}
            disabled={workspace.busy}
            onClick={() => void workspace.logout()}
          >
            <LogOut aria-hidden="true" />
          </Button>
        ) : null}
      </header>
      {workspace.session === 'anonymous' ? (
        <B2bLogin
          title={COPY.loginTitle}
          subtitle={COPY.loginHint}
          email={login.email}
          password={login.password}
          onEmailChange={login.setEmail}
          onPasswordChange={login.setPassword}
          onSubmit={() => void login.submit()}
          busy={workspace.busy}
          error={workspace.error}
        />
      ) : workspace.session === 'loading' ? (
        <p className={styles.empty} role="status">
          {COPY.loading}
        </p>
      ) : workspace.session === 'blocked' || workspace.session === 'unavailable' ? (
        <main className={styles.empty}>
          <ErrorNote
            title={workspace.session === 'unavailable' ? COPY.disconnected : COPY.blocked}
            message={workspace.error ?? COPY.errors.unavailable}
            onRetry={workspace.session === 'unavailable' ? workspace.reconnect : undefined}
            retryLabel={COPY.retry}
          />
        </main>
      ) : (
        <PipelineWorkspace workspace={workspace} />
      )}
    </div>
  );
}
