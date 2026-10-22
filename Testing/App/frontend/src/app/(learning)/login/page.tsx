'use client';

import { AuthLegalNotice } from '@/components/legal/AuthLegalNotice';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OAuthButtons } from '@/components/onboarding/OAuthButtons';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { AUTH_COPY, LOGIN_FORM_ID } from '@/config/auth';
import { layout } from '@/config/layout';
import { COPY, ROUTES } from '@/config/onboarding-steps';
import { useLogin } from '@/hooks/use-login';

export default function LoginPage() {
  const login = useLogin();

  return (
    <ScreenTransition>
      <ScreenShell
        className={layout.auth.shell}
        footer={
          <div className={layout.auth.footer}>
            <Button
              type="submit"
              form={LOGIN_FORM_ID}
              className={layout.cta}
              disabled={!login.valid || login.pending}
            >
              {login.pending ? AUTH_COPY.signingIn : COPY.login.action}
            </Button>
            <OAuthButtons redirectTo={ROUTES.home} separator="before" />
            <Button
              variant="ghost"
              className={layout.cta}
              disabled={login.pending}
              onClick={login.register}
            >
              {COPY.login.noAccount}
            </Button>
            <AuthLegalNotice mode="login" />
          </div>
        }
      >
        <ScreenHeading title={COPY.login.title} subtitle={COPY.login.subtitle} />
        <form
          id={LOGIN_FORM_ID}
          className={layout.auth.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void login.submit();
          }}
        >
          <div className={layout.auth.field}>
            <Label htmlFor="email">{AUTH_COPY.email}</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              disabled={login.pending}
              value={login.email}
              onChange={(event) => login.setEmail(event.target.value)}
            />
          </div>
          <div className={layout.auth.field}>
            <Label htmlFor="password">{AUTH_COPY.password}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              disabled={login.pending}
              value={login.password}
              onChange={(event) => login.setPassword(event.target.value)}
            />
          </div>
          {login.error ? <ErrorNote message={login.error} /> : null}
        </form>
      </ScreenShell>
    </ScreenTransition>
  );
}
