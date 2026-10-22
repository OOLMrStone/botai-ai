import { MathFormula } from '@/components/common/MathFormula';
import { layout } from '@/config/layout';
import { tokenizeGridRichText } from '@/lib/grid-rich-text';
import { cn } from '@/lib/utils';

export function ExpertRichText({ value, className }: { value: string; className?: string }) {
  const styles = layout.expertRichText;
  const segments = tokenizeGridRichText(value);

  return (
    <span className={cn(styles.root, className)}>
      {segments.map((segment, index) =>
        segment.kind === 'math' ? (
          <MathFormula
            key={index}
            value={segment.value}
            displayMode={segment.displayMode}
            inline
            className={segment.displayMode ? styles.displayMath : styles.inlineMath}
          />
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </span>
  );
}
