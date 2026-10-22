import { ArrowDownRight, Check, CircleAlert, Lightbulb } from 'lucide-react';
import { MathFormula } from '@/components/common/MathFormula';
import { IntervalDiagram } from '@/components/experimental/IntervalDiagram';
import { SolutionPointPopover } from '@/components/experimental/SolutionPointPopover';
import {
  EXPERIMENTAL_COPY,
  EXPERIMENTAL_POINTS,
  type ExperimentalPointId,
  type ExperimentalSolutionSection,
} from '@/config/experimental';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface SolutionStepProps {
  section: ExperimentalSolutionSection;
  selected: boolean;
  hoverEnabled: boolean;
  disputed: boolean;
  onPointOpen: (id: ExperimentalPointId, open: boolean) => void;
  onDispute: (id: ExperimentalPointId) => void;
}

export function SolutionStep({
  section,
  selected,
  hoverEnabled,
  disputed,
  onPointOpen,
  onDispute,
}: SolutionStepProps) {
  const styles = layout.experimentalSolution;
  const copy = EXPERIMENTAL_COPY.solution;
  const point = section.pointId ? EXPERIMENTAL_POINTS[section.pointId] : null;

  if (!point) return null;

  const tone = styles.tones[point.status];
  const Icon =
    point.status === 'correct'
      ? Check
      : point.status === 'error'
        ? CircleAlert
        : point.status === 'inherited'
          ? ArrowDownRight
          : Lightbulb;

  return (
    <section
      className={cn(styles.section, section.width === 'half' && styles.sectionHalf)}
      data-review-point={point.id}
    >
      <SolutionPointPopover
        point={point}
        open={selected}
        hoverEnabled={hoverEnabled}
        disputed={disputed}
        onPointOpen={onPointOpen}
        onDispute={() => onDispute(point.id)}
      >
        <button
          id={point.elementId}
          type="button"
          aria-expanded={selected}
          aria-label={point.title}
          className={styles.trigger}
        >
          <span
            aria-hidden="true"
            className={cn(
              styles.highlight,
              tone.background,
              selected ? styles.highlightSelected : styles.highlightHover,
            )}
          />
          <span aria-hidden="true" className={cn(styles.marker, tone.marker)} />
          <span className={styles.number}>{section.number}</span>
          <span className={styles.content}>
            <span className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>{section.title}</span>
              <span className={cn(styles.status, point.status === 'error' && tone.text)}>
                <Icon className={cn(styles.statusIcon, tone.text)} aria-hidden="true" />
                <span className={point.status === 'correct' ? styles.statusTextHidden : undefined}>
                  {point.status === 'error' ? point.title : copy[point.status]}
                </span>
                {point.formattingNote ? (
                  <span className={styles.formatBadge} aria-label={copy.formatting} role="img">
                    <Lightbulb className={styles.formatBadgeIcon} aria-hidden="true" />
                  </span>
                ) : null}
              </span>
            </span>
            {section.kind === 'intervals' ? (
              <IntervalDiagram />
            ) : (
              <span
                className={cn(
                  styles.formulas,
                  section.layout === 'columns' && styles.formulasColumns,
                )}
              >
                {section.formulas.map((formula) => (
                  <MathFormula
                    key={formula}
                    value={formula}
                    className={cn(
                      styles.formula,
                      (section.layout === 'columns' || section.width === 'half') &&
                        styles.formulaCompact,
                      point.status === 'error' && tone.text,
                    )}
                    displayMode
                    inline
                  />
                ))}
              </span>
            )}
          </span>
        </button>
      </SolutionPointPopover>
    </section>
  );
}
