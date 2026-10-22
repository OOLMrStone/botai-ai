import { Plus, Trash2 } from 'lucide-react';
import { FormSection } from '@/components/common/FormSection';
import {
  GeometryNumberField,
  GeometryBoundaryField,
  GeometrySignField,
  GeometryTextField,
  GeometryToggle,
} from '@/components/expert/ExpertGeometryControls';
import { Button } from '@/components/ui/button';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { ExpertGeometryFeedback } from '@/components/expert/ExpertGeometryFeedback';
import type { ExpertNumberLine } from '@/config/expert';
import { EXPERT_UI, EXPERT_UI_COPY } from '@/config/expert-ui';
import { EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import { layout } from '@/config/layout';
import type { GridGeometryFields } from '@/hooks/use-grid-geometry';
import { expertNumberLineFeedback } from '@/lib/expert-geometry-feedback';
import {
  geometryPointExpression,
  patchGeometryItem,
  removeGeometryPoint,
  selectGeometryPoint,
  updateGeometryPoint,
} from '@/lib/grid-geometry';

interface ExpertNumberLineEditorProps {
  axis: ExpertNumberLine;
  onChange: (axis: ExpertNumberLine) => void;
  fields: GridGeometryFields;
  allowPresentation?: boolean;
}

export function ExpertNumberLineEditor({
  axis,
  onChange,
  fields,
  allowPresentation = true,
}: ExpertNumberLineEditorProps) {
  const styles = layout.expert;
  const copy = EXPERT_UI_COPY;
  const feedback = expertNumberLineFeedback(axis);
  const patchAxis = (patch: Partial<ExpertNumberLine>) => onChange({ ...axis, ...patch });

  return (
    <div className={styles.editorSection}>
      <div className={styles.editorGrid}>
        <GeometryTextField
          label={copy.axisLabel}
          value={axis.label}
          onChange={(label) => patchAxis({ label })}
        />
        {allowPresentation ? (
          <div className={styles.editorGrid}>
            <GeometryNumberField
              label={copy.axisMin}
              field={fields.required('axis.min', axis.min, (min) => patchAxis({ min }))}
            />
            <GeometryNumberField
              label={copy.axisMax}
              field={fields.required('axis.max', axis.max, (max) => patchAxis({ max }))}
            />
          </div>
        ) : null}
      </div>
      <ExpertGeometryFeedback message={feedback.axis} />
      <FormSection title={copy.points}>
        <div className={styles.editorSection}>
          {axis.points.map((point) => {
            const field = fields.expression(
              point.id,
              geometryPointExpression(point),
              (value, label) => onChange(updateGeometryPoint(axis, point.id, { value, label })),
            );

            return (
              <div key={point.id} className={styles.geometryCard}>
                <ExpertMathField
                  label={copy.pointValue}
                  value={field.value}
                  onChange={field.onChange}
                  onValidityChange={(ready) => fields.setMathValidity(point.id, ready)}
                />
                <ExpertGeometryFeedback
                  message={
                    field.invalid
                      ? EXPERT_GEOMETRY_COPY.invalidCoordinate
                      : feedback.points.get(point.id)
                  }
                />
                <div className={styles.geometryPointSettings}>
                  <GeometrySignField
                    label={copy.pointSign}
                    value={point.sign}
                    onChange={(sign) => onChange(updateGeometryPoint(axis, point.id, { sign }))}
                  />
                  <GeometryToggle
                    label={copy.pointIncluded}
                    checked={point.included}
                    onChange={(included) =>
                      onChange(updateGeometryPoint(axis, point.id, { included }))
                    }
                  />
                  {allowPresentation ? (
                    <GeometryToggle
                      label={copy.pointSelected}
                      checked={axis.selectedPoints.includes(point.id)}
                      onChange={(selected) =>
                        onChange(selectGeometryPoint(axis, point.id, selected))
                      }
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    aria-label={copy.removePoint}
                    onClick={() => {
                      fields.clear(point.id);
                      axis.intervals
                        .filter(
                          (interval) =>
                            interval.from === point.value || interval.to === point.value,
                        )
                        .forEach((interval) => fields.clear(interval.id));
                      onChange(removeGeometryPoint(axis, point.id));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() =>
              patchAxis({
                points: [...axis.points, { ...EXPERT_UI.newPoint, id: fields.createId() }],
              })
            }
          >
            <Plus aria-hidden="true" />
            {copy.addPoint}
          </Button>
        </div>
      </FormSection>
      <FormSection title={copy.intervals}>
        <div className={styles.editorSection}>
          {axis.intervals.map((interval) => (
            <div key={interval.id} className={styles.geometryCard}>
              <div className={styles.geometryRow}>
                <GeometryBoundaryField
                  label={copy.from}
                  value={interval.from}
                  fields={fields}
                  fieldKey={`${interval.id}.from`}
                  points={axis.points}
                  allowCustom={allowPresentation}
                  infinity={EXPERT_GEOMETRY_COPY.negativeInfinity}
                  onChange={(from) =>
                    patchAxis({
                      intervals: patchGeometryItem(axis.intervals, interval.id, { from }),
                    })
                  }
                />
                <GeometryBoundaryField
                  label={copy.to}
                  value={interval.to}
                  fields={fields}
                  fieldKey={`${interval.id}.to`}
                  points={axis.points}
                  allowCustom={allowPresentation}
                  infinity={EXPERT_GEOMETRY_COPY.positiveInfinity}
                  onChange={(to) =>
                    patchAxis({ intervals: patchGeometryItem(axis.intervals, interval.id, { to }) })
                  }
                />
                <GeometrySignField
                  label={copy.intervalSign}
                  allowZero={false}
                  value={interval.sign}
                  onChange={(sign) =>
                    patchAxis({
                      intervals: patchGeometryItem(axis.intervals, interval.id, { sign }),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-compact"
                  aria-label={copy.removeInterval}
                  onClick={() => {
                    fields.clear(interval.id);
                    patchAxis({
                      intervals: axis.intervals.filter((item) => item.id !== interval.id),
                    });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <ExpertGeometryFeedback message={feedback.intervals.get(interval.id)} />
              <GeometryToggle
                label={copy.intervalSelected}
                checked={interval.selected}
                onChange={(selected) =>
                  patchAxis({
                    intervals: patchGeometryItem(axis.intervals, interval.id, { selected }),
                  })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() =>
              patchAxis({
                intervals: [...axis.intervals, { ...EXPERT_UI.newInterval, id: fields.createId() }],
              })
            }
          >
            <Plus aria-hidden="true" />
            {copy.addInterval}
          </Button>
        </div>
      </FormSection>
      {allowPresentation ? (
        <FormSection title={copy.domain}>
          <div className={styles.editorSection}>
            <GeometryToggle
              label={copy.domainEnabled}
              checked={axis.domain !== null}
              onChange={(enabled) => {
                fields.clear('domain');
                patchAxis({ domain: enabled ? { from: null, to: null } : null });
              }}
            />
            {axis.domain ? (
              <div className={styles.editorGrid}>
                <GeometryNumberField
                  label={copy.from}
                  hint={copy.infinityHint}
                  field={fields.optional('domain.from', axis.domain.from, (from) =>
                    patchAxis({ domain: { from, to: axis.domain?.to ?? null } }),
                  )}
                />
                <GeometryNumberField
                  label={copy.to}
                  hint={copy.infinityHint}
                  field={fields.optional('domain.to', axis.domain.to, (to) =>
                    patchAxis({ domain: { from: axis.domain?.from ?? null, to } }),
                  )}
                />
              </div>
            ) : null}
            <ExpertGeometryFeedback message={feedback.domain} />
          </div>
        </FormSection>
      ) : null}
    </div>
  );
}
