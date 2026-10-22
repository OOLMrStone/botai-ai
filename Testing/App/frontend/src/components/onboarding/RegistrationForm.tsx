'use client';

import { ErrorNote } from '@/components/common/ErrorNote';
import { AuthLegalNotice } from '@/components/legal/AuthLegalNotice';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ValidatedField } from '@/components/onboarding/ValidatedField';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AUTH_COPY, REGISTER_FIELDS, REGISTER_FORM_ID } from '@/config/auth';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import type { useRegistration } from '@/hooks/use-registration';
import { REGISTRATION_VALIDATORS } from '@/lib/registration';

export function RegistrationForm({ form }: { form: ReturnType<typeof useRegistration> }) {
  return (
    <ScreenShell
      scrollPage
      className={layout.auth.registrationShell}
      footer={
        <div className={layout.auth.registerFooter}>
          <Button
            type="submit"
            form={REGISTER_FORM_ID}
            className={layout.cta}
            disabled={!form.valid || form.pending}
          >
            {form.pending ? AUTH_COPY.registering : COPY.register.account.action}
          </Button>
          <AuthLegalNotice mode="register" />
        </div>
      }
    >
      <ScreenHeading title={COPY.register.account.title} />
      <form
        id={REGISTER_FORM_ID}
        className={layout.auth.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      >
        {REGISTER_FIELDS.map((field) => (
          <div key={field.name} className={layout.auth.field}>
            <Label htmlFor={field.name}>{AUTH_COPY[field.name]}</Label>
            <ValidatedField
              id={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              disabled={form.pending}
              value={form.registration[field.name]}
              onChange={(value) => form.updateRegistration({ [field.name]: value })}
              validate={REGISTRATION_VALIDATORS[field.name]}
              errorText={COPY.validation[field.error]}
            />
          </div>
        ))}
        {form.error ? <ErrorNote message={form.error} /> : null}
      </form>
    </ScreenShell>
  );
}
