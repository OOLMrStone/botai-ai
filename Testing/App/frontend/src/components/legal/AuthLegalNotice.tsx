import Link from 'next/link';

import { LEGAL_AUTH_NOTICE as C } from '@/config/legal-navigation';
import { layout } from '@/config/layout';
import { legalPath } from '@/config/onboarding-steps';

export function AuthLegalNotice({ mode }: { mode: keyof typeof C.prefix }) {
  return (
    <p className={layout.legal.authNotice}>
      {C.prefix[mode]}{' '}
      {C.links.map((link) => (
        <span key={link.document}>
          {link.separator}
          <Link href={legalPath(link.document)} className={layout.legal.noticeLink}>
            {link.label}
          </Link>
        </span>
      ))}
      {C.end}
    </p>
  );
}
