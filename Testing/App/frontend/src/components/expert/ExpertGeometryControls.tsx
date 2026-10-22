import { ExpertSelect } from '@/components/expert/ExpertSelect';
import type { ChangeEvent } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { EXPERT_UI } from '@/config/expert-ui';
import { EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import { formatGeometryAngle, formatGeometryCoordinate } from '@/lib/grid-geometry';
import { layout } from '@/config/layout';
import type { GridGeometryFields } from '@/hooks/use-grid-geometry';
import { EXPERT_UI_COPY } from '@/config/expert-ui';

export function GeometryNumberField({
  label,
  field,
  hint,
}: {
  label: string;
  field: {
    value: string;
    invalid: boolean;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  };
  hint?: string;
}) {
  return (
    <label className={layout.expert.inputLabel}>
      {label}
      <Input
        value={field.value}
        onChange={field.onChange}
        aria-invalid={field.invalid}
        autoComplete="off"
      />
      {hint ? <span className={layout.expert.contactLabel}>{hint}</span> : null}
    </label>
  );
}

export function GeometryTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={layout.expert.inputLabel}>
      {label}
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function GeometryToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={layout.expert.checkLabel}>
      <span className={layout.expert.checkboxControl}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className={layout.expert.checkbox}
        />
        <Check aria-hidden="true" className={layout.expert.checkboxIcon} />
      </span>
      {label}
    </label>
  );
}

export function GeometrySignField({
  label,
  value,
  onChange,
  allowZero = true,
}: {
  label: string;
  value: '+' | '-' | '0' | null;
  onChange: (value: '+' | '-' | '0' | null) => void;
  allowZero?: boolean;
}) {
  const options = EXPERT_UI.signs.filter((option) => allowZero || option.value !== '0');

  return (
    <label className={layout.expert.inputLabel}>
      {label}
      <ExpertSelect
        value={value ?? ''}
        onChange={(event) => {
          const selected = options.find((option) => option.value === event.target.value);
          if (selected) onChange(selected.value || null);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </ExpertSelect>
    </label>
  );
}

export function GeometryEndpointField({
  label,
  value,
  options,
  onChange,
  infinity,
  angles = false,
  pointId,
}: {
  label: string;
  value: number | null;
  options: { id: string; value: number }[];
  onChange: (value: number | null, pointId?: string) => void;
  infinity?: string;
  angles?: boolean;
  pointId?: string;
}) {
  const selected = pointId ?? options.find((option) => option.value === value)?.id ?? '';

  return (
    <label className={layout.expert.inputLabel}>
      {label}
      <ExpertSelect
        value={selected}
        onChange={(event) => {
          const point = options.find((option) => option.id === event.target.value);
          onChange(point?.value ?? null, point?.id);
        }}
      >
        {infinity ? <option value="">{infinity}</option> : null}
        {options.map((option, index) => (
          <option key={option.id} value={option.id}>
            {EXPERT_GEOMETRY_COPY.endpoint(
              angles ? formatGeometryAngle(option.value) : formatGeometryCoordinate(option.value),
              index,
            )}
          </option>
        ))}
      </ExpertSelect>
    </label>
  );
}

export function GeometryBoundaryField({
  label,
  value,
  onChange,
  fields,
  fieldKey,
  points,
  allowCustom,
  infinity,
  angles = false,
  pointId,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null, pointId?: string) => void;
  fields: GridGeometryFields;
  fieldKey: string;
  points: { id: string; value: number }[];
  allowCustom: boolean;
  infinity?: string;
  angles?: boolean;
  pointId?: string;
}) {
  if (!allowCustom)
    return (
      <GeometryEndpointField
        label={label}
        value={value}
        onChange={onChange}
        options={points}
        infinity={infinity}
        angles={angles}
        pointId={pointId}
      />
    );

  const field = infinity
    ? fields.optional(fieldKey, value, onChange)
    : fields.required(fieldKey, value ?? EXPERT_UI.newArc.from, onChange, angles);

  return (
    <GeometryNumberField
      label={label}
      field={field}
      hint={infinity ? EXPERT_UI_COPY.infinityHint : undefined}
    />
  );
}
