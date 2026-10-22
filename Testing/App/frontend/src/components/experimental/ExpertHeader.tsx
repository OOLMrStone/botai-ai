import { Wordmark } from '@/components/onboarding/Wordmark';
import { EXPERIMENTAL_WORKSPACE_COPY as COPY } from '@/config/experimental-workspace';
import { layout } from '@/config/layout';

export function ExpertHeader() {
  const styles = layout.experimental;

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <Wordmark variant="compact" />
        <span className={styles.brandDivider} aria-hidden="true" />
        <span className={styles.product}>{COPY.expert}</span>
      </div>
      <div className={styles.account}>
        <span className={styles.avatar} aria-label={COPY.expert}>
          {COPY.expertInitials}
        </span>
      </div>
    </header>
  );
}
