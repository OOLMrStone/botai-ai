import Image from 'next/image';
import { MathFormula } from '@/components/common/MathFormula';

import { layout } from '@/config/layout';
import {
  TASK_DEFAULT_IMAGE_ASPECT_RATIO,
  TASK_IMAGE_SIZES,
  TASK_CONTENT,
  type TaskBlock,
  type TaskRun,
} from '@/config/tasks';
import { cn } from '@/lib/utils';
import { formulaStyle, taskMediaSrc } from '@/lib/task-content';

function InlineRun({ run }: { run: TaskRun }) {
  if (run.type === 'text') return run.value;
  if (run.type === 'latex')
    return <MathFormula inline value={run.value} className={layout.training.inlineLatex} />;
  const src = taskMediaSrc(run.src);
  return src ? (
    <Image
      unoptimized
      src={src}
      alt={run.alt ?? TASK_CONTENT.formulaAlt}
      width={run.width}
      height={run.height}
      className={layout.training.inlineFormula}
      style={formulaStyle(run)}
    />
  ) : null;
}

export function TaskBlockRenderer({ blocks }: { blocks: TaskBlock[] }) {
  return (
    <div className={layout.training.blockList}>
      {blocks.map((block, index) => {
        if (block.type === 'text')
          return (
            <p key={index} className={layout.training.blockText}>
              {block.value}
            </p>
          );
        if (block.type === 'latex')
          return (
            <MathFormula
              key={index}
              displayMode
              value={block.value}
              className={layout.training.latex}
            />
          );
        if (block.type === 'paragraph')
          return (
            <p key={index} className={layout.training.blockText}>
              {block.runs.map((run, index) => (
                <InlineRun key={index} run={run} />
              ))}
            </p>
          );
        if (block.type !== 'image') return null;
        const src = taskMediaSrc(block.src);
        if (!src) return null;
        return (
          <div
            key={index}
            className={layout.training.image}
            style={{ aspectRatio: block.aspectRatio ?? TASK_DEFAULT_IMAGE_ASPECT_RATIO }}
          >
            <Image
              src={src}
              unoptimized
              alt={block.alt}
              fill
              className={cn(
                layout.training.blockImage,
                block.colorMode === 'monochrome' && layout.training.blockImageMonochrome,
              )}
              sizes={TASK_IMAGE_SIZES}
              loading="eager"
            />
          </div>
        );
      })}
    </div>
  );
}
