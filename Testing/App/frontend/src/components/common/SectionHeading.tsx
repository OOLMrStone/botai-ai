import { layout } from '@/config/layout';

export function SectionHeading({ children }: { children: string }) {
  return <h2 className={layout.typography.sectionTitle}>{children}</h2>;
}
