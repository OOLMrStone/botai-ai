import { MathFormula } from '@/components/common/MathFormula';
import { ExpertSelect } from '@/components/expert/ExpertSelect';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function NativeGeometryChoice<T extends string | boolean | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={layout.expert.inputLabel}>
      <span>{label}</span>
      <div
        className={cn(layout.expert.taskTabs, layout.expert.tabs)}
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <Button
            key={String(option.value)}
            type="button"
            variant="ghost"
            size="compact"
            aria-pressed={value === option.value}
            className={cn(
              layout.expert.navButton,
              value === option.value && layout.expert.taskActive,
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function NativeGeometryEndpoint({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; formula: string | null }[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.id === value);

  return (
    <div className={layout.expert.inputLabel}>
      <label className={layout.expert.inputLabel}>
        {label}
        <ExpertSelect value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </ExpertSelect>
      </label>
      {selected?.formula ? (
        <MathFormula value={selected.formula} className={layout.expertSolution.formulas} />
      ) : null}
    </div>
  );
}
