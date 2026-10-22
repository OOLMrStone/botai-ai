'use client';

import { ProfileAvatar } from '@/components/app/ProfileAvatar';
import { ErrorNote } from '@/components/common/ErrorNote';
import { FileUploadButton } from '@/components/common/FileUploadButton';
import { FormSection } from '@/components/common/FormSection';
import { Button } from '@/components/ui/button';
import { DISABLED_ACTION_COPY } from '@/config/disabled-action';
import { INTEGRATION, LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { PROFILE_COPY } from '@/config/profile';
import type { useProfile } from '@/hooks/use-profile';

export function ProfileAccountSettings({
  profile,
  email,
  verified,
}: {
  profile: ReturnType<typeof useProfile>;
  email: string;
  verified: boolean;
}) {
  return (
    <div className={layout.settings.account}>
      <FormSection title={PROFILE_COPY.photo}>
        <div className={layout.settings.avatarRow}>
          <ProfileAvatar url={profile.data?.avatarUrl} />
          <div className={layout.settings.avatarActions}>
            <FileUploadButton
              label={profile.busy ? LEARNING_COPY.uploading : LEARNING_COPY.changeAvatar}
              accept={INTEGRATION.imageAccept}
              disabled={profile.busy}
              onAdd={profile.addAvatar}
            />
            {profile.data?.avatarUrl ? (
              <Button variant="ghost" disabled={profile.busy} onClick={() => void profile.avatar()}>
                {LEARNING_COPY.removeAvatar}
              </Button>
            ) : null}
          </div>
        </div>
      </FormSection>
      <p className={layout.app.profile.email}>{email}</p>
      {!verified ? (
        <Button
          variant="outline"
          disabled={profile.verificationBusy || profile.verificationSent}
          disabledReason={
            !profile.verificationBusy ? DISABLED_ACTION_COPY.verificationSent : undefined
          }
          onClick={() => void profile.verify()}
        >
          {profile.verificationSent ? LEARNING_COPY.verifySent : LEARNING_COPY.verify}
        </Button>
      ) : null}
      {profile.error ? <ErrorNote message={profile.error} /> : null}
    </div>
  );
}
