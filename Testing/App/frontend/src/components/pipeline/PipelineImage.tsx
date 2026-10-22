import Image from 'next/image';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import { pipelinePrivateUrl } from '@/lib/pipeline-console';

export function PipelineImage({
  src,
  title,
  width = CONFIG.previewWidth,
  height = CONFIG.previewHeight,
}: {
  src: string;
  title: string;
  width?: number;
  height?: number;
}) {
  const url = pipelinePrivateUrl(src);
  const styles = layout.pipelineConsole;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!url) return <p className={styles.secondary}>{COPY.unavailableImage}</p>;
  return (
    <a
      className={styles.media}
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${COPY.openImage}: ${title}`}
    >
      {failedSrc === url ? (
        <span className={styles.empty}>{COPY.unavailableImage}</span>
      ) : (
        <Image
          src={url}
          alt={title}
          width={width}
          height={height}
          className={styles.image}
          unoptimized
          onError={() => setFailedSrc(url)}
        />
      )}
      <span className={styles.imageCaption}>
        {title}
        <ExternalLink className={styles.statusIcon} aria-hidden="true" />
      </span>
    </a>
  );
}
