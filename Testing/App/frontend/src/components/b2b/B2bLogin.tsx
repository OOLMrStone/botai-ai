import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { B2B_COPY as COPY } from '@/config/b2b';
import { layout } from '@/config/layout';

interface B2bLoginProps {
  title: string;
  subtitle: string;
  email: string;
  password: string;
  busy: boolean;
  error?: string | null;
  children?: ReactNode;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
}

export function B2bLogin(props: B2bLoginProps) {
  const styles = layout.expert;

  return (
    <main className={styles.login}>
      <ScreenHeading title={props.title} subtitle={props.subtitle} variant="app" />
      <form
        className={styles.loginForm}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <label className={styles.inputLabel}>
          {COPY.email}
          <Input
            type="email"
            autoComplete="username"
            required
            value={props.email}
            disabled={props.busy}
            onChange={(event) => props.onEmailChange(event.target.value)}
          />
        </label>
        <label className={styles.inputLabel}>
          {COPY.password}
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={props.password}
            disabled={props.busy}
            onChange={(event) => props.onPasswordChange(event.target.value)}
          />
        </label>
        {props.error ? <ErrorNote message={props.error} /> : null}
        <Button type="submit" disabled={props.busy || !props.email.trim() || !props.password}>
          {props.busy ? COPY.signingIn : COPY.login}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>
      {props.children}
    </main>
  );
}
