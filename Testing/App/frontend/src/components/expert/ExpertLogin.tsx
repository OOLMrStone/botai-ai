import { B2bLogin } from '@/components/b2b/B2bLogin';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY } from '@/config/expert';
import { IS_MOCK_API } from '@/config/env';
import { layout } from '@/config/layout';
import { useGridLogin, type GridWorkspace } from '@/hooks/use-grid-ui';

export function ExpertLogin({ workspace }: { workspace: GridWorkspace }) {
  const styles = layout.expert;
  const form = useGridLogin(workspace);

  return (
    <B2bLogin
      title={COPY.loginTitle}
      subtitle={COPY.loginSubtitle}
      email={form.email}
      password={form.password}
      busy={workspace.busy}
      onEmailChange={form.setEmail}
      onPasswordChange={form.setPassword}
      onSubmit={() => void form.submit()}
    >
      {IS_MOCK_API ? (
        <>
          <div className={styles.loginDivider} />
          <div className={styles.stack}>
            <Button
              variant="outline"
              onClick={() => void workspace.enterDemo()}
              disabled={workspace.busy}
            >
              {COPY.demo}
            </Button>
            <p className={styles.footerHint}>{COPY.demoHint}</p>
          </div>
        </>
      ) : null}
    </B2bLogin>
  );
}
