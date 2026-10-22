import katex from 'katex';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';
import { MATH_RENDERING } from '@/config/math';

export function MathFormula({
  value,
  className,
  displayMode = false,
  inline = false,
}: {
  value: string;
  className?: string;
  displayMode?: boolean;
  inline?: boolean;
}) {
  const html = katex.renderToString(value, {
    throwOnError: false,
    output: 'htmlAndMathml',
    displayMode,
    ...MATH_RENDERING,
  });

  const Element = inline ? 'span' : 'div';
  return (
    <Element
      className={cn(layout.mathFormula, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
