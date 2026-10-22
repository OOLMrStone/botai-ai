import Image from 'next/image';
import { UserRound } from 'lucide-react';

import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { PROFILE_AVATAR } from '@/config/profile';

export function ProfileAvatar({ url }: { url?: string | null }) {
  return (
    <div className={layout.app.profile.avatar}>
      {url ? (
        <Image
          src={url}
          alt={LEARNING_COPY.avatar}
          width={PROFILE_AVATAR.size}
          height={PROFILE_AVATAR.size}
          className={layout.integration.avatarImage}
        />
      ) : (
        <UserRound className={layout.app.profile.avatarIcon} aria-hidden="true" />
      )}
    </div>
  );
}
