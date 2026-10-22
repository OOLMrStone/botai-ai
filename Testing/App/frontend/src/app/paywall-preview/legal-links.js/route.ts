import { LEGAL_PAYWALL_LINKS } from '@/config/legal-navigation';
import { legalPath } from '@/config/onboarding-steps';

export const dynamic = 'force-static';

export function GET() {
  const links = LEGAL_PAYWALL_LINKS.map(({ document, label }) => ({
    label,
    href: legalPath(document),
  }));

  return new Response(`window.BOTAI_PAYWALL_LEGAL_LINKS = ${JSON.stringify(links)};`, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
}
