import Image from 'next/image';
import { Expand } from 'lucide-react';
import { EXPERIMENTAL_WORKSPACE_COPY as COPY } from '@/config/experimental-workspace';
import { layout } from '@/config/layout';

export function ReviewSource({ photoUrl, onOpen }: { photoUrl: string; onOpen: () => void }) {
  const styles = layout.experimental;

  return (
    <button type="button" className={styles.source} onClick={onOpen}>
      <span className={styles.sourceThumb}>
        <Image src={photoUrl} alt="" fill unoptimized className={styles.sourceImage} />
      </span>
      <span className={styles.sourceCopy}>
        <span className={styles.label}>{COPY.source}</span>
        <span className={styles.caption}>{COPY.sourceHint}</span>
      </span>
      <Expand className={styles.sourceArrow} aria-hidden="true" />
    </button>
  );
}
